// ==========================================
// 1. นำ Firebase Config ของคุณมาใส่ตรงนี้
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBpFKXdCwbCcRcFIg49pyEkZVw6p2ysb_c",
  authDomain: "food-calorie-b1018.firebaseapp.com",
  projectId: "food-calorie-b1018",
  storageBucket: "food-calorie-b1018.firebasestorage.app",
  messagingSenderId: "269409646095",
  appId: "1:269409646095:web:2032ec3073d258c655157a",
  measurementId: "G-HF2XKHKSZL"
};
// เช็คว่าเริ่มต้น Firebase ไปหรือยัง (กัน Error หน้าโหลดซ้ำ)
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.firestore();

// ==========================================
// 2. อ้างอิง UI Elements
// ==========================================
const DAILY_TARGET = 2000; // เป้าหมายแคลอรีรายวัน

const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');

const apiKeyInput = document.getElementById('api-key-input');
const saveKeyBtn = document.getElementById('save-key-btn');
const clearKeyBtn = document.getElementById('clear-key-btn');
const keyStatus = document.getElementById('key-status');

const imageInput = document.getElementById('food-image');
const loadingIndicator = document.getElementById('loading-indicator');
const foodList = document.getElementById('food-list');
const currentCalEl = document.getElementById('current-cal');
const targetCalEl = document.getElementById('target-cal');
const calorieFill = document.getElementById('calorie-fill');
const dietStatus = document.getElementById('diet-status');

let currentUser = null;
let storedApiKey = localStorage.getItem('gemini_api_key');
targetCalEl.textContent = DAILY_TARGET;

// ==========================================
// 3. ระบบ API Key Management
// ==========================================
function updateKeyUI() {
    if (storedApiKey) {
        apiKeyInput.value = '********';
        apiKeyInput.disabled = true;
        saveKeyBtn.classList.add('hidden');
        clearKeyBtn.classList.remove('hidden');
        keyStatus.textContent = "✅ เชื่อมต่อ AI สำเร็จ พร้อมสแกนแล้ว!";
        keyStatus.style.color = "#27ae60";
    } else {
        apiKeyInput.value = '';
        apiKeyInput.disabled = false;
        saveKeyBtn.classList.remove('hidden');
        clearKeyBtn.classList.add('hidden');
        keyStatus.textContent = "❌ ยังไม่ได้ใส่ API Key (AI จะทำงานไม่ได้)";
        keyStatus.style.color = "var(--danger)";
    }
}

saveKeyBtn.onclick = () => {
    const key = apiKeyInput.value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        storedApiKey = key;
        updateKeyUI();
    }
};

clearKeyBtn.onclick = () => {
    localStorage.removeItem('gemini_api_key');
    storedApiKey = null;
    updateKeyUI();
};

// ==========================================
// 4. ระบบ Authentication
// ==========================================
loginBtn.onclick = () => auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
logoutBtn.onclick = () => auth.signOut();

auth.onAuthStateChanged((user) => {
    if (user) {
        currentUser = user;
        document.getElementById('player-name').textContent = `👋 ${user.displayName}`;
        loginScreen.classList.add('hidden');
        appScreen.classList.remove('hidden');
        
        updateKeyUI(); 
        loadDailyFood();
    } else {
        currentUser = null;
        loginScreen.classList.remove('hidden');
        appScreen.classList.add('hidden');
    }
});

// ==========================================
// 5. ระบบวิเคราะห์รูปภาพด้วย AI
// ==========================================
imageInput.addEventListener('change', async (e) => {
    if (!storedApiKey) {
        alert("⚠️ กรุณากรอก Gemini API Key ก่อนเริ่มสแกนอาหารครับ");
        imageInput.value = '';
        return;
    }

    const file = e.target.files[0];
    if (!file) return;

    loadingIndicator.classList.remove('hidden');

    try {
        const base64Image = await convertToBase64(file);
        const cleanBase64 = base64Image.split(',')[1];
        
        // ส่งให้ AI และรอรับผลลัพธ์
        const aiResult = await analyzeFoodWithAI(cleanBase64, file.type);
        
        // บันทึกลงฐานข้อมูล
        await saveFoodToDatabase(aiResult.foodName, aiResult.calories);
        alert(`✅ เพิ่มเมนู: ${aiResult.foodName} (${aiResult.calories} kcal) สำเร็จ!`);
        
    } catch (error) {
        console.error("Error หลัก:", error);
        alert(`เกิดข้อผิดพลาด: ${error.message}\nโปรดเช็ค API Key ว่าถูกต้องหรือไม่ หรือลองเปิด Console (F12) เพื่อดูสาเหตุเพิ่มเติมครับ`);
    } finally {
        loadingIndicator.classList.add('hidden');
        imageInput.value = '';
    }
});

function convertToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });
}

// 🔴 อัปเดตล่าสุด: ใช้ -latest และมีการดักจับ Error
async function analyzeFoodWithAI(base64Data, mimeType) {
   const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:generateContent?key=${storedApiKey}`;
    
    const prompt = `
        Analyze this food image. Provide the common Thai name of the food and estimate its total calories. 
        You MUST respond ONLY with a valid JSON object in this exact format, with no markdown formatting or other text:
        { "foodName": "ชื่ออาหารภาษาไทย", "calories": 500 }
    `;

    const requestBody = {
        contents: [{
            parts: [
                { text: prompt },
                { inline_data: { mime_type: mimeType, data: base64Data } }
            ]
        }]
    };

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody)
    });

    const data = await response.json();

    // ดัก Error จาก AI ถ้ารหัสสถานะไม่ใช่ 200 OK
    if (!response.ok) {
        console.error("รายละเอียด Error จากเซิร์ฟเวอร์ AI:", data);
        throw new Error(`AI API Error: ${data.error?.message || 'ไม่ทราบสาเหตุ'}`);
    }

    let aiText = data.candidates[0].content.parts[0].text;
    
    // ทำความสะอาดข้อความ JSON
    aiText = aiText.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(aiText);
}

// ==========================================
// 6. ระบบฐานข้อมูล (Firestore)
// ==========================================
async function saveFoodToDatabase(name, calories) {
    const today = new Date().toISOString().split('T')[0]; 
    await db.collection('users').doc(currentUser.uid)
            .collection('foodLogs').add({
        foodName: name,
        calories: Number(calories),
        dateString: today,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
}

function loadDailyFood() {
    const today = new Date().toISOString().split('T')[0];
    
    db.collection('users').doc(currentUser.uid).collection('foodLogs')
      .where("dateString", "==", today)
      .orderBy("timestamp", "asc")
      .onSnapshot((snapshot) => {
          foodList.innerHTML = '';
          let totalCalories = 0;

          snapshot.forEach((doc) => {
              const food = doc.data();
              totalCalories += food.calories;
              
              const div = document.createElement('div');
              div.className = 'food-item';
              div.innerHTML = `<span>${food.foodName}</span> <span>${food.calories} kcal</span>`;
              foodList.appendChild(div);
          });

          if (snapshot.empty) {
              foodList.innerHTML = '<p style="color: gray; text-align: center;">ยังไม่ได้กินอะไรเลย</p>';
          }

          updateDashboard(totalCalories);
      }, (error) => {
          console.error("ดึงข้อมูล Firebase ไม่สำเร็จ:", error);
      });
}

function updateDashboard(total) {
    currentCalEl.textContent = total;
    
    let percentage = (total / DAILY_TARGET) * 100;
    if (percentage > 100) percentage = 100;
    calorieFill.style.width = `${percentage}%`;

    if (total > DAILY_TARGET) {
        calorieFill.style.backgroundColor = "var(--danger)";
        dietStatus.textContent = "🚨 ทะลุเป้าแล้ว! พรุ่งนี้เอาใหม่นะ";
        dietStatus.style.color = "var(--danger)";
    } else if (total > DAILY_TARGET - 300) {
        calorieFill.style.backgroundColor = "var(--accent)";
        dietStatus.textContent = "⚠️ ใกล้เต็มโควต้าแล้ว ระวังหน่อย";
        dietStatus.style.color = "#d63031";
    } else {
        calorieFill.style.backgroundColor = "var(--primary)";
        dietStatus.textContent = "👍 ยังกินได้อีกชิลๆ";
        dietStatus.style.color = "#27ae60";
    }
}
