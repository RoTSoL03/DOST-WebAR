export default function nodeFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetch(input, init);
}

export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
