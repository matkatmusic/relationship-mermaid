import { watch } from "node:fs";

export function isValidName(name) {
  return /^[a-zA-Z0-9_-]+\.mmd$/.test(name);
}

if (import.meta.main) Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === "/") {
      return new Response(Bun.file("index.html"));
    }

    if (url.pathname === "/viewer.js") {
      return new Response(Bun.file("viewer.js"), { headers: { "Content-Type": "text/javascript" } });
    }

    if (url.pathname === "/api/diagrams" && req.method === "GET") {
      const glob = new Bun.Glob("*.mmd");
      const names = await Array.fromAsync(glob.scan({ cwd: "diagrams" }));
      return Response.json(names.sort());
    }

    const match = url.pathname.match(/^\/api\/diagrams\/([^/]+)$/);
    if (match) {
      const name = match[1];
      if (!isValidName(name)) {
        return new Response("Invalid diagram name", { status: 400 });
      }
      const file = Bun.file(`diagrams/${name}`);

      if (req.method === "GET") {
        if (!(await file.exists())) return new Response("Not found", { status: 404 });
        return new Response(file);
      }

      if (req.method === "PUT") {
        const text = await req.text();
        await Bun.write(`diagrams/${name}`, text);
        return new Response("OK");
      }
    }

    const watchMatch = url.pathname.match(/^\/api\/watch\/([^/]+)$/);
    if (watchMatch && req.method === "GET") {
      const name = watchMatch[1];
      if (!isValidName(name)) {
        return new Response("Invalid diagram name", { status: 400 });
      }
      const encoder = new TextEncoder();
      let watcher;
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(":ok\n\n"));
          watcher = watch(`diagrams/${name}`, () => {
            controller.enqueue(encoder.encode("data: changed\n\n"));
          });
        },
        cancel() {
          watcher.close();
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    }

    return new Response("Not found", { status: 404 });
  },
});

if (import.meta.main) console.log("Mermaid viewer running at http://localhost:3000");
