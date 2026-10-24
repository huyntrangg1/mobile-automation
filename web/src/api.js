async function call(method, url, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`/api${url}`, {
    method,
    headers: body && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error(data?.error || res.statusText), { data, status: res.status });
  return data;
}

export const api = {
  get: (u) => call('GET', u),
  post: (u, b) => call('POST', u, b),
  put: (u, b) => call('PUT', u, b),
  del: (u) => call('DELETE', u),
};
