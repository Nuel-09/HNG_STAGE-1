const crypto = require("crypto");
const {
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_WEB_REDIRECT_URI,
  OAUTH_SUCCESS_REDIRECT,
  NODE_ENV
} = require("../config/env");
const { OAuthState } = require("../models/oauthState");
const { exchangeCode, fetchGithubUser, fetchPrimaryEmail } = require("../services/githubOAuthService");
const { upsertUserFromGithub } = require("../services/userService");
const {
  signAccessToken,
  issueRefreshToken,
  consumeRefreshTokenAndRotate,
  revokeRefreshToken,
  REFRESH_TTL_MS
} = require("../services/tokenService");
const { challengeFromVerifier } = require("../utils/pkce");
const { sendError } = require("../utils/http");

const cookieOpts = {
  httpOnly: true,
  secure: NODE_ENV === "production",
  sameSite: "lax",
  path: "/"
};

const csrfCookieOpts = {
  httpOnly: false,
  secure: NODE_ENV === "production",
  sameSite: "lax",
  path: "/"
};

/** TRD Web Portal: CSRF double-submit (readable cookie + X-CSRF-Token header on mutations). */
const issueCsrfToken = (req, res) => {
  const token = crypto.randomBytes(32).toString("hex");
  res.cookie("csrf_token", token, csrfCookieOpts);
  return res.status(200).json({ status: "success", csrf_token: token });
};

const startGithub = async (req, res) => {
  try {
    if (!GITHUB_CLIENT_ID) {
      return sendError(res, 500, "GitHub OAuth not configured");
    }

    const { state: cliState, code_challenge: cliCodeChallenge, redirect_uri } = req.query;

    if (cliCodeChallenge && redirect_uri && cliState) {
      const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
      authorizeUrl.searchParams.set("client_id", GITHUB_CLIENT_ID);
      authorizeUrl.searchParams.set("redirect_uri", String(redirect_uri));
      authorizeUrl.searchParams.set("state", String(cliState));
      authorizeUrl.searchParams.set("code_challenge", String(cliCodeChallenge));
      authorizeUrl.searchParams.set("code_challenge_method", "S256");
      authorizeUrl.searchParams.set("scope", "read:user user:email");
      return res.redirect(authorizeUrl.toString());
    }

    if (!GITHUB_WEB_REDIRECT_URI) {
      return sendError(res, 500, "GITHUB_WEB_REDIRECT_URI not configured");
    }

    const state = crypto.randomBytes(24).toString("hex");
    const code_verifier = crypto.randomBytes(32).toString("base64url");
    const code_challenge = challengeFromVerifier(code_verifier);

    await OAuthState.create({
      state,
      code_verifier,
      expires_at: new Date(Date.now() + 10 * 60 * 1000)
    });

    const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
    authorizeUrl.searchParams.set("client_id", GITHUB_CLIENT_ID);
    authorizeUrl.searchParams.set("redirect_uri", GITHUB_WEB_REDIRECT_URI);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", code_challenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    authorizeUrl.searchParams.set("scope", "read:user user:email");

    return res.redirect(authorizeUrl.toString());
  } catch (error) {
    return sendError(res, 500, "Internal server error");
  }
};

const githubCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    if (!code || !state) {
      return sendError(res, 400, "Missing or empty parameter");
    }

    const record = await OAuthState.findOne({ state: String(state) });
    if (!record || record.expires_at < new Date()) {
      return sendError(res, 400, "Invalid OAuth state");
    }

    await OAuthState.deleteOne({ _id: record._id });

    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET || !GITHUB_WEB_REDIRECT_URI) {
      return sendError(res, 500, "GitHub OAuth not configured");
    }

    const ghAccess = await exchangeCode({
      code: String(code),
      code_verifier: record.code_verifier,
      redirect_uri: GITHUB_WEB_REDIRECT_URI,
      clientId: GITHUB_CLIENT_ID,
      clientSecret: GITHUB_CLIENT_SECRET
    });

    const ghUser = await fetchGithubUser(ghAccess);
    let email = ghUser.email || "";
    if (!email) email = await fetchPrimaryEmail(ghAccess);

    const user = await upsertUserFromGithub(ghUser, email);
    if (!user.is_active) {
      return sendError(res, 403, "Account is disabled");
    }

    const access_token = signAccessToken(user);
    const refresh_token = await issueRefreshToken(user.id);

    res.cookie("access_token", access_token, { ...cookieOpts, maxAge: 3 * 60 * 1000 });
    res.cookie("refresh_token", refresh_token, { ...cookieOpts, maxAge: REFRESH_TTL_MS });

    return res.redirect(OAUTH_SUCCESS_REDIRECT);
  } catch (error) {
    if (error?.statusCode) {
      return sendError(res, error.statusCode, error.message);
    }
    return sendError(res, 500, "Internal server error");
  }
};

const githubToken = async (req, res) => {
  try {
    const { code, code_verifier, redirect_uri } = req.body || {};
    if (
      code === undefined ||
      typeof code !== "string" ||
      !code.trim() ||
      code_verifier === undefined ||
      typeof code_verifier !== "string" ||
      !code_verifier.trim() ||
      redirect_uri === undefined ||
      typeof redirect_uri !== "string" ||
      !redirect_uri.trim()
    ) {
      return sendError(res, 400, "Missing or empty parameter");
    }

    if (!GITHUB_CLIENT_ID || !GITHUB_CLIENT_SECRET) {
      return sendError(res, 500, "GitHub OAuth not configured");
    }

    const ghAccess = await exchangeCode({
      code: code.trim(),
      code_verifier: code_verifier.trim(),
      redirect_uri: redirect_uri.trim(),
      clientId: GITHUB_CLIENT_ID,
      clientSecret: GITHUB_CLIENT_SECRET
    });

    const ghUser = await fetchGithubUser(ghAccess);
    let email = ghUser.email || "";
    if (!email) email = await fetchPrimaryEmail(ghAccess);

    const user = await upsertUserFromGithub(ghUser, email);
    if (!user.is_active) {
      return sendError(res, 403, "Account is disabled");
    }

    const access_token = signAccessToken(user);
    const refresh_token = await issueRefreshToken(user.id);

    return res.status(200).json({
      status: "success",
      access_token,
      refresh_token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        avatar_url: user.avatar_url
      }
    });
  } catch (error) {
    if (error?.statusCode) {
      return sendError(res, error.statusCode, error.message);
    }
    return sendError(res, 500, "Internal server error");
  }
};

const refresh = async (req, res) => {
  try {
    const bodyToken = req.body?.refresh_token;
    const cookieToken = req.cookies?.refresh_token;
    const refresh_token =
      typeof bodyToken === "string" && bodyToken.trim()
        ? bodyToken.trim()
        : typeof cookieToken === "string"
          ? cookieToken
          : null;

    if (!refresh_token) {
      return sendError(res, 400, "Missing or empty parameter");
    }

    const { access_token, refresh_token: new_refresh, user } = await consumeRefreshTokenAndRotate(
      refresh_token
    );

    if (!user.is_active) {
      return sendError(res, 403, "Account is disabled");
    }

    if (req.cookies?.refresh_token) {
      res.cookie("access_token", access_token, { ...cookieOpts, maxAge: 3 * 60 * 1000 });
      res.cookie("refresh_token", new_refresh, { ...cookieOpts, maxAge: REFRESH_TTL_MS });
    }

    return res.status(200).json({
      status: "success",
      access_token,
      refresh_token: new_refresh
    });
  } catch (error) {
    if (error?.statusCode === 401) {
      return sendError(res, 401, error.message);
    }
    if (error?.statusCode === 403) {
      return sendError(res, 403, error.message);
    }
    return sendError(res, 500, "Internal server error");
  }
};

const logout = async (req, res) => {
  try {
    const bodyToken = req.body?.refresh_token;
    const cookieToken = req.cookies?.refresh_token;
    const refresh_token =
      typeof bodyToken === "string" && bodyToken.trim()
        ? bodyToken.trim()
        : typeof cookieToken === "string"
          ? cookieToken
          : null;

    if (refresh_token) {
      await revokeRefreshToken(refresh_token);
    }

    res.clearCookie("access_token", { ...cookieOpts });
    res.clearCookie("refresh_token", { ...cookieOpts });

    return res.status(200).json({ status: "success", message: "Logged out" });
  } catch {
    return sendError(res, 500, "Internal server error");
  }
};

module.exports = {
  startGithub,
  githubCallback,
  githubToken,
  issueCsrfToken,
  refresh,
  logout
};
