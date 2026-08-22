/**
 * Minimal `next/server` test double.
 *
 * Lives OUTSIDE node_modules on purpose. An earlier version of the harness
 * wrote a stub into node_modules/next/, which replaced the real Next.js
 * install and broke `next build` ("exports is not defined in ES module
 * scope"). Nothing in the harness may mutate a real dependency.
 *
 * tests/resolver.mjs maps the "next/server" specifier here. Only the
 * surface the code under test actually touches is implemented — the real
 * module pulls in the whole framework and cannot load in a plain Node
 * process.
 */
export class NextResponse {
  constructor(body, init) {
    this.body = body;
    this.status = init?.status ?? 200;
    this.headers = new Map(Object.entries(init?.headers ?? {}));
    this.cookies = {
      set: () => {},
      get: () => undefined,
      delete: () => {},
    };
  }

  static json(data, init) {
    const response = new NextResponse(data, init);
    response.data = data;
    response.json = async () => data;
    return response;
  }

  static redirect(url, init) {
    const response = new NextResponse(null, { status: 302, ...init });
    response.url = typeof url === "string" ? url : String(url);
    return response;
  }
}

export class NextRequest {
  constructor(input, init) {
    this.url = typeof input === "string" ? input : String(input);
    this.method = init?.method ?? "GET";
    this.headers = new Map(Object.entries(init?.headers ?? {}));
  }
}
