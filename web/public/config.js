(function () {
  // ตั้ง API_URL เป็นโดเมน API ที่ Render สร้างให้
  window.API_URL = 'https://web-weather-api.onrender.com';

  // ถ้าอยาก fallback กลับ localhost ตอน dev ก็ทำเงื่อนไขเพิ่ม
  if (location.hostname === 'localhost') {
    window.API_URL = 'http://localhost:4000';
  }
})();
