/* eslint-disable max-len */
const {onCall, HttpsError} = require("firebase-functions/v2/https");

// Retired endpoints must fail closed; they must never bypass the per-student PIN API.
const retired = () => {
  throw new HttpsError("failed-precondition", "This endpoint is retired. Update the app and use the secure CBT API.");
};

exports.startExamSession = onCall(retired);
exports.submitExamSession = onCall(retired);
exports.setUserRole = onCall(retired);
