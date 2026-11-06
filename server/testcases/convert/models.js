// Model cho các bước nhẹ của chuyển đổi (lọc case, lập khung): chọn / sắp xếp, không cần model mạnh → nhanh và rẻ hơn.
// Bước viết dòng Keyword không ép model: dùng model mặc định của người dùng (QAPD_AI_MODEL hoặc Claude Code).
export const lightModel = () => process.env.QAPD_CONVERT_LIGHT_MODEL || 'claude-sonnet-5-5';
