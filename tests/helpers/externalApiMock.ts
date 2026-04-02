import { vi } from "vitest";

type MockResponse = {
  ok: boolean;
  status: number;
};

export function mockExternalApis(responses: MockResponse[]): void {
  const sequence = [...responses];

  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const next = sequence.shift() ?? { ok: true, status: 200 };
      return next as Response;
    })
  );
}

export function restoreExternalApisMock(): void {
  vi.unstubAllGlobals();
}
