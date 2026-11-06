import os from 'node:os';

// Địa chỉ IPv4 trong mạng nội bộ của máy chạy server — in ra để gửi link cho team
export function lanUrls(port, ifaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces)) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${port}`);
  return out;
}
