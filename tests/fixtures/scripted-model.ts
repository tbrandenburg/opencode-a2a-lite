// Local OpenAI-compatible chat fixture: answers each model turn with the next scripted tool call,
// then a final text. Lets the real OpenCode executable run tools without a provider.
export type Call = { name: string; args: Record<string, unknown> };

export function scriptedModel(calls: readonly Call[]) {
  const encoder = new TextEncoder();
  const chunk = (delta: object, finish: string | null) =>
    encoder.encode(
      `data: ${JSON.stringify({ id: "c", object: "chat.completion.chunk", created: 1, model: "m", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
    );
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      if (new URL(request.url).pathname.endsWith("/models"))
        return Response.json({ data: [{ id: "m", object: "model" }] });
      const body = (await request.json()) as { messages?: { role: string }[] };
      const done = (body.messages ?? []).filter((message) => message.role === "tool").length;
      const call = calls[done];
      const frames = call
        ? [
            chunk(
              {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call${done}`,
                    type: "function",
                    function: { name: call.name, arguments: JSON.stringify(call.args) },
                  },
                ],
              },
              null,
            ),
            chunk({}, "tool_calls"),
          ]
        : [chunk({ role: "assistant", content: "finished" }, null), chunk({}, "stop")];
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const frame of [...frames, encoder.encode("data: [DONE]\n\n")])
              controller.enqueue(frame);
            controller.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, stop: () => void server.stop(true) };
}
