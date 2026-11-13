import { limitMutation } from "../server/rate-limit.mjs";
import { backend } from "../cbt-app/server/firebase-admin.mjs";
import { createService } from "../server/service.mjs";
import { assert } from "../server/domain.mjs";

export async function POST(request) {
  try {
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer (.+)$/)?.[1];
    assert(token, 401, "Please sign in to continue.");
    assert(
      Number(request.headers.get("content-length") || 0) < 200000,
      413,
      "Request is too large.",
    );
    const text = await request.text();
    assert(text.length < 200000, 413, "Request is too large.");
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      assert(false, 400, "Invalid request.");
    }
    assert(
      body && typeof body === "object" && !Array.isArray(body),
      400,
      "Invalid request.",
    );
    const dependencies = backend();
    const service = createService(dependencies);
    if (
      ![
        "lan.sync",
        "exam.start",
        "exam.progress",
        "exam.submit",
        "account.verify",
      ].includes(body.action)
    ) {
      let claims;
      try {
        claims = await dependencies.auth.verifyIdToken(token, true);
      } catch {
        assert(false, 401, "Please sign in again.");
      }
      await limitMutation(dependencies.db, claims.uid, body.action);
    }
    const result =
      body.action === "lan.sync"
        ? await service.syncLan(token, body)
        : body.action === "teachers.register"
          ? await service.registerTeacher(token, body)
          : await service.execute(
              await service.identity(token, {
                allowPending: body.action === "account.verify",
              }),
              body.action,
              body,
            );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (!error.status)
      console.error("CBT API request failed", error.code || error.name);
    const status = error.status || 500;
    return Response.json(
      {
        error:
          status === 500
            ? "The exam service is unavailable. Contact your administrator; any pending submission stays saved on this device."
            : error.message,
      },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
