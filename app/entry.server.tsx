import { PassThrough } from "node:stream";
import { renderToPipeableStream } from "react-dom/server";
import { createReadableStreamFromReadable } from "@remix-run/node";
import { RemixServer } from "@remix-run/react";
import type { EntryContext } from "@remix-run/node";

export const streamTimeout = 5_000;

export default function handleRequest(
  _request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  remixContext: EntryContext
) {
  return new Promise((resolve, reject) => {
    const { pipe, abort } = renderToPipeableStream(
      <RemixServer
        context={remixContext}
        url={_request.url}
        abortDelay={streamTimeout}
      />,
      {
        onShellReady() {
          const body = new PassThrough();
          const stream = createReadableStreamFromReadable(body);
          responseHeaders.set("Content-Type", "text/html");
          pipe(body);
          resolve(
            new Response(stream, {
              headers: responseHeaders,
              status: responseStatusCode,
            })
          );
        },
        onShellError(error: unknown) {
          reject(error);
        },
      }
    );
    setTimeout(abort, streamTimeout + 1_000);
  });
}
