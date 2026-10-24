// Số liệu mong đợi theo công thức PRD Onboarding mục 1.2.
// Làm tròn: calo làm tròn gần nhất, tuần làm tròn lên (giả định onboarding-qna #9).

export function ageOn(birth, today = new Date()) {
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export function birthdayForAge(age, today = new Date(), month = 2, day = 15) {
  // Ngày sinh 15/03 → đã qua sinh nhật nếu hôm nay sau 15/03
  const d = new Date(today.getFullYear() - age, month, day);
  return ageOn(d, today) === age ? d : new Date(today.getFullYear() - age - 1, month, day);
}

export function bmi(kg, cm) {
  return Math.round((kg / (cm / 100) ** 2) * 10) / 10;
}

export function expectedPlan({ sex, cm, kg, goalKg, age }) {
  const bmr = 10 * kg + 6.25 * cm - 5 * age + (sex === 'Male' ? 5 : -161);
  const intake = Math.max(Math.round(bmr * 1.55 - 500), 1200);
  const weeks = Math.ceil(((kg - goalKg) * 7700) / 500 / 7 - 1e-9);
  return { intake, burn: 300, weeks };
}

export function lossPercent(kg, goalKg) {
  return Math.round(((kg - goalKg) / kg) * 1000) / 10;
}
