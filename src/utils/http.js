const sendError = (res, statusCode, message) =>
  res.status(statusCode).json({ status: "error", message });

const buildProfileResponse = (doc) => ({
  id: doc.id,
  name: doc.name,
  gender: doc.gender,
  gender_probability: doc.gender_probability,
  age: doc.age,
  age_group: doc.age_group,
  country_id: doc.country_id,
  country_name: doc.country_name,
  country_probability: doc.country_probability,
  created_at: new Date(doc.created_at).toISOString()
});

module.exports = { sendError, buildProfileResponse };
