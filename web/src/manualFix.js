// Chế độ sửa tay khi lỗi: nhớ lựa chọn lần trước của tester (trình duyệt này); không đọc được storage → tắt
export const loadManualFix = () => { try { return localStorage.getItem('qapd.manualFix') === '1'; } catch { return false; } };
export const saveManualFix = (on) => { try { localStorage.setItem('qapd.manualFix', on ? '1' : '0'); } catch {} };
// AI hỗ trợ khi chạy: bước thao tác / điều hướng kẹt thì AI gỡ (không đụng điểm kiểm); tắt khi bật sửa tay
export const loadAiAssist = () => { try { return localStorage.getItem('qapd.aiAssist') === '1'; } catch { return false; } };
export const saveAiAssist = (on) => { try { localStorage.setItem('qapd.aiAssist', on ? '1' : '0'); } catch {} };
// Thiết bị cho "Run lại" theo từng app (chọn máy khác máy của run cũ, vd máy ảo mới); không có → dùng máy của run cũ
export const loadRerunDevice = (appId) => { try { return localStorage.getItem(`qapd.rerunDevice.${appId}`) || ''; } catch { return ''; } };
export const saveRerunDevice = (appId, udid) => { try { localStorage.setItem(`qapd.rerunDevice.${appId}`, udid || ''); } catch {} };
