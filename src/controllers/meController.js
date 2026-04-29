const getMe = (req, res) => {
  const u = req.user;
  return res.status(200).json({
    status: "success",
    data: {
      id: u.id,
      username: u.username,
      email: u.email,
      avatar_url: u.avatar_url,
      role: u.role,
      is_active: u.is_active
    }
  });
};

module.exports = { getMe };
