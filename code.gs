// ==========================================
// การตั้งค่าเริ่มต้น (Configuration) สำหรับ Firestore
// ==========================================

// Project ID ของคุณ (จาก config ที่คุณให้มา)
const PROJECT_ID = "bookingroomsw"; 

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId(); 
const SHEET_NAME = "Users"; 

// --- ตั้งค่า Telegram ---
const TELEGRAM_BOT_TOKEN = "7638096136:AAGUTv60o734AxJkWta7YF4phf10LQD4Olw"; 
const TELEGRAM_CHAT_ID = "-1002544982439";

// ==========================================
// ฟังก์ชันหลักสำหรับแสดงผลหน้าเว็บ
// ==========================================
function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('ระบบจองห้องประชุม SW (Firestore)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ==========================================
// ฟังก์ชัน Sync ข้อมูลจาก Sheet ไปยัง Firestore ผ่าน REST API
// ==========================================
function syncUsersToFirestore() {
  const sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error("ข้อผิดพลาด: ไม่พบชีตชื่อ '" + SHEET_NAME + "'");
  }

  // ใส่ API Key ของคุณ
  const API_KEY = "AIzaSyA9w0sQ1Vj23o-JNZYfqu4RJknUjzdPKCw"; 
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users`;

  // 1. เคลียร์ข้อมูลเดิมใน Firestore (ลบทีละรายการพร้อมรองรับ Pagination)
  try {
    let pageToken = "";
    do {
      let listUrl = `${baseUrl}?key=${API_KEY}&pageSize=100` + (pageToken ? `&pageToken=${pageToken}` : "");
      let listResponse = UrlFetchApp.fetch(listUrl, { method: 'get', muteHttpExceptions: true });
      
      if (listResponse.getResponseCode() === 200) {
        let listData = JSON.parse(listResponse.getContentText());
        
        if (listData.documents && listData.documents.length > 0) {
          listData.documents.forEach(doc => {
            let docPath = `https://firestore.googleapis.com/v1/${doc.name}?key=${API_KEY}`;
            UrlFetchApp.fetch(docPath, { method: 'delete', muteHttpExceptions: true });
          });
        }
        
        pageToken = listData.nextPageToken || ""; // ตรวจสอบว่ามีหน้าถัดไปหรือไม่
      } else {
        pageToken = ""; // ถ้าดึงข้อมูลไม่ได้ให้หยุดลูป
      }
    } while (pageToken);
    
  } catch (e) {
    console.log("เกิดข้อผิดพลาดระหว่างการลบข้อมูล: " + e.message);
  }

  // 2. เริ่มขั้นตอนการเขียนข้อมูลใหม่ (Sync)
  const data = sheet.getDataRange().getDisplayValues();
  let successCount = 0;
  
  // เริ่มอ่านจากแถวที่ 2
  for (let i = 1; i < data.length; i++) {
    let username = data[i][0].toString().trim();
    if (username === "") continue;

    // จัดฟอร์แมตข้อมูลให้ตรงกับ Cloud Firestore REST API
    let payload = {
      "fields": {
        "password": { "stringValue": data[i][1].toString().trim() },
        "name": { "stringValue": data[i][2].toString().trim() },
        "department": { "stringValue": data[i][3].toString().trim() },
        "role": { "stringValue": data[i][4].toString().trim().toLowerCase() }
      }
    };
    
    // ใช้เมธอด PATCH เพื่อสร้างหรืออัปเดต Document (ใช้ username เป็น ID)
    let url = `${baseUrl}/${username}?key=${API_KEY}`;
    
    let options = {
      method: 'patch',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    
    try {
      let response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() === 200) {
        successCount++;
      }
    } catch (err) {
      console.log("ข้ามรายการที่เกิดข้อผิดพลาด: " + username);
    }
    
    // ป้องกันการยิง Request เร็วเกินไป (Rate Limit) ในกรณีข้อมูลเยอะมาก
    if (i % 20 === 0) {
      Utilities.sleep(100); 
    }
  }
  
  return "เคลียร์ข้อมูลเก่าและ Sync ใหม่สำเร็จจำนวน " + successCount + " รายการ!";
}

// ==========================================
// ฟังก์ชันแจ้งเตือนผ่าน Telegram
// ==========================================
function sendTelegramNotification(bookingData, actionText) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

  const startDT = new Date(bookingData.start);
  const endDT = new Date(bookingData.end);
  const formatDate = (date) => Utilities.formatDate(date, "Asia/Bangkok", "dd/MM/yyyy HH:mm");

  // ตรวจสอบ Action ว่าเป็นการ จองใหม่, แก้ไข หรือ ยกเลิก
  let emoji = "✅"; 
  if (actionText.includes("ยกเลิก")) {
    emoji = "❌";
  } else if (actionText.includes("แก้ไข")) {
    emoji = "📝";
  }
  
  let message = `${emoji} <b>${actionText}</b>\n\n`;
  message += `<b>📌 หัวข้อ:</b> ${bookingData.title}\n`;
  message += `<b>🚪 ห้องประชุม:</b> ${bookingData.room}\n`;
  message += `<b>👤 ผู้จอง:</b> ${bookingData.name} (${bookingData.department})\n`;
  message += `<b>⏱ เริ่ม:</b> ${formatDate(startDT)}\n`;
  message += `<b>🏁 สิ้นสุด:</b> ${formatDate(endDT)}\n`;
  
  // เพิ่มการแสดงหมายเหตุ (ถ้ามี)
  if (bookingData.note && bookingData.note.trim() !== "") {
    message += `<b>💬 หมายเหตุ:</b> ${bookingData.note}\n`;
  }
  
  if (bookingData.actionBy && bookingData.actionBy !== bookingData.name) {
    message += `\n<i>(ผู้ดำเนินการ: ${bookingData.actionBy})</i>`;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "HTML"
    }),
    muteHttpExceptions: true
  };

  try { 
    UrlFetchApp.fetch(url, options); 
  } catch (e) {
    console.log("Telegram Error: " + e.message);
  }
}

// ==========================================
// ฟังก์ชัน API สำหรับทำงานร่วมกับ GitHub Pages
// ==========================================
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const action = data.action;

    if (action === "syncUsers") {
      const result = syncUsersToFirestore();
      return ContentService.createTextOutput(JSON.stringify({ status: "success", message: result }))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === "sendTelegram") {
      sendTelegramNotification(data.bookingData, data.actionText);
      return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
        .setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput(JSON.stringify({ status: "error", message: "Invalid action" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
