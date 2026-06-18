/**
 * backend/utils.js
 * Utility helper functions for InsightDocs AI backend.
 */

/**
 * Generates a random 6-digit numeric OTP.
 * @returns {string} 6-digit number as a string.
 */
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = {
  generateOTP,
};
