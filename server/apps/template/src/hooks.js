// Hook của dự án cho keyword Run setup / Run check (bộ keyword v2). Tên hook = cột Value trong Excel.
// Mỗi hook nhận { driver, vars, env }: vars = biến của TC ({{tên}}), env = biến môi trường của app (Cài đặt app).
//
// setup[tên]: chuẩn bị trước bước kế tiếp — seed data, giả lập lỗi, đặt ngày… Ném lỗi → TC Blocked.
// check[tên]: kiểm phía backend → trả { pass: true / false, actual?, expected? } (actual / expected hiện trong report khi sai).
//
// Ví dụ:
// export const setup = {
//   'seed-recipes': async ({ env }) => { await fetch(`${env.API_URL}/test/seed`, { method: 'POST' }); },
// };
// export const check = {
//   'user-created': async ({ env, vars }) => {
//     const r = await fetch(`${env.API_URL}/test/users?email=${encodeURIComponent(vars.email)}`);
//     return { pass: r.ok, actual: r.status, expected: 200 };
//   },
// };

export const setup = {};
export const check = {};
