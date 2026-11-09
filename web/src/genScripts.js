// Gen script cho các case. Case có code đã sửa tay → server trả 409: hỏi tester trước khi ghi đè (gửi lại với force)
import { api } from './api.js';

export async function genScripts(appId, caseIds) {
  try {
    return await api.post(`/apps/${appId}/scripts/generate`, { caseIds });
  } catch (e) {
    if (e.status !== 409 || !e.data?.editedByHand?.length) throw e;
    if (!window.confirm(`${e.message}\n\nGen lại sẽ GHI ĐÈ code bạn đã sửa tay của ${e.data.editedByHand.length} case này (tool giữ bản .bak). Tiếp tục?`)) return null;
    return api.post(`/apps/${appId}/scripts/generate`, { caseIds, force: true });
  }
}
