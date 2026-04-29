const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const GITHUB_EMAILS_URL = "https://api.github.com/user/emails";

const exchangeCode = async ({ code, code_verifier, redirect_uri, clientId, clientSecret }) => {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirect_uri,
    code_verifier: code_verifier
  });

  const res = await fetch(GITHUB_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    const err = new Error(data.error_description || data.error || "GitHub token exchange failed");
    err.statusCode = 502;
    throw err;
  }
  if (!data.access_token) {
    const err = new Error("GitHub token exchange returned no access_token");
    err.statusCode = 502;
    throw err;
  }
  return data.access_token;
};

const fetchGithubUser = async (githubAccessToken) => {
  const res = await fetch(GITHUB_USER_URL, {
    headers: {
      Authorization: `Bearer ${githubAccessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Insighta-Labs-Backend"
    }
  });
  if (!res.ok) {
    const err = new Error("Failed to fetch GitHub user");
    err.statusCode = 502;
    throw err;
  }
  return res.json();
};

const fetchPrimaryEmail = async (githubAccessToken) => {
  const res = await fetch(GITHUB_EMAILS_URL, {
    headers: {
      Authorization: `Bearer ${githubAccessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "Insighta-Labs-Backend"
    }
  });
  if (!res.ok) return "";
  const emails = await res.json();
  if (!Array.isArray(emails)) return "";
  const primary = emails.find((e) => e.primary && e.verified);
  return primary?.email || emails[0]?.email || "";
};

module.exports = { exchangeCode, fetchGithubUser, fetchPrimaryEmail };
