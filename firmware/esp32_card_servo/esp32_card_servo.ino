#include <WiFi.h>
#include <WebServer.h>
#include <ESP32Servo.h>

// --- CẤU HÌNH WI-FI ---
const char* ssid = "Phuc";          // Tên Wi-Fi của bạn
const char* password = "123123123"; // Mật khẩu Wi-Fi của bạn

WebServer server(80);

Servo servoInsert; // Chân D18 - MG996R 360 (Chèn thẻ)
Servo servoSwipe;  // Chân D33 - MG996R 360 (Quẹt thẻ)
Servo servoNFC;    // Chân D19 - SG90 180 (Vẫy thẻ NFC)

int pinInsert = 18; 
int pinSwipe = 33;  
int pinNFC = 19;   // <-- DÂY TÍN HIỆU SG90 CẮM VÀO CHÂN D19

// Hàm cho 2 Servo 360 độ (Hỗ trợ delayTime mili-giây dạng float)
void runServo(Servo &sv, int pin, int speedAngle, int delayTime) {
  sv.setPeriodHertz(50);
  sv.attach(pin, 500, 2400); 
  sv.write(speedAngle);      
  delay(delayTime);          
  sv.write(90);              
  delay(150);                
  sv.detach();               
}

// Hàm cho SG90: Quay đến góc tùy ý (0 - 180) và giữ nguyên vị trí đó
void runServoAngle(int targetAngle) {
  servoNFC.setPeriodHertz(50);
  servoNFC.attach(pinNFC, 500, 2400);
  servoNFC.write(targetAngle);
  delay(500);        // Đợi 0.5s cho SG90 chạy tới đúng góc
  servoNFC.detach(); // Ngắt xung để không bị rung/kêu
}

// Hàm cho SG90: Vẫy ra góc tùy ý -> giữ 1 giây -> tự thu về 0 độ
void tapNFCAngle(int targetAngle) {
  servoNFC.setPeriodHertz(50);
  servoNFC.attach(pinNFC, 500, 2400);
  
  servoNFC.write(targetAngle); // Vươn tới góc bạn nhập
  delay(1000);                 // Giữ thẻ 1 giây cho máy POS đọc
  
  servoNFC.write(0);           // Tự động thu về góc 0
  delay(500);                  
  servoNFC.detach();           
}

void processCommand(String input) {
  input.trim();
  if (input.length() == 0) return;

  char prefix = input.charAt(0);
  // Dùng toFloat() để hỗ trợ cả số thực dưới 1 (VD: 0.5s, 0.2s)
  float valFloat = input.substring(1).toFloat();
  int valInt = (int)valFloat;

  // --- 1. ĐIỀU KHIỂN SG90 QUAY TỚI GÓC TÙY Ý (g0 -> g180) ---
  if (prefix == 'g' || prefix == 'G') {
    if (valInt >= 0 && valInt <= 180) {
      Serial.print("SG90 (D19) Quay den goc: "); Serial.println(valInt);
      runServoAngle(valInt);
      Serial.println("-> SG90 Da dung o goc " + String(valInt));
    } else {
      Serial.println("Loi: Goc phai tu 0 den 180 (VD: g0, g45, g135)");
    }
    return;
  }

  // --- 2. ĐIỀU KHIỂN SG90 VẪY TỚI GÓC TÙY Ý RỒI THU VỀ (n1 -> n180) ---
  if (prefix == 'n' || prefix == 'N') {
    if (valInt >= 0 && valInt <= 180) {
      Serial.print("SG90 (D19) Vay NFC den goc: "); Serial.print(valInt); Serial.println(" roi thu ve 0");
      tapNFCAngle(valInt);
      Serial.println("-> Da vay NFC xong!");
    } else {
      Serial.println("Loi: Goc vay phai tu 0 den 180 (VD: n90, n120)");
    }
    return;
  }

  // --- 3. ĐIỀU KHIỂN 2 SERVO MG996R (Hỗ trợ số thực float < 1s như 0.5s, 0.8s) ---
  if (valFloat > 0.0f) {
    int delayTime = (int)(valFloat * 1000.0f);

    if (prefix == 'l' || prefix == 'L') {
      Serial.print("Chan 18 Quay TRAI: "); Serial.print(valFloat); Serial.println("s");
      runServo(servoInsert, pinInsert, 0, delayTime);
      Serial.println("-> Da dung!");
    } 
    else if (prefix == 'r' || prefix == 'R') {
      Serial.print("Chan 18 Quay PHAI: "); Serial.print(valFloat); Serial.println("s");
      runServo(servoInsert, pinInsert, 180, delayTime);
      Serial.println("-> Da dung!");
    }
    else if (prefix == 'a' || prefix == 'A') {
      Serial.print("Chan 33 Quay TIEN: "); Serial.print(valFloat); Serial.println("s");
      runServo(servoSwipe, pinSwipe, 0, delayTime);
      Serial.println("-> Da dung!");
    } 
    else if (prefix == 'b' || prefix == 'B') {
      Serial.print("Chan 33 Quay LUI: "); Serial.print(valFloat); Serial.println("s");
      runServo(servoSwipe, pinSwipe, 180, delayTime);
      Serial.println("-> Da dung!");
    } 
    else {
      Serial.println("Sai lenh! Dung: l, r, a, b (theo giay) hoac g, n (theo goc 0-180)");
    }
  } else {
    Serial.println("Loi: Thoi gian quay phai lon hon 0 (VD: 0.5, 1, 2.5)");
  }
}

void handleControl() {
  if (server.hasArg("cmd")) {
    String command = server.arg("cmd");
    Serial.println("Nhan lenh HTTP: " + command);
    server.send(200, "text/plain", "OK: " + command);
    processCommand(command);
  } else {
    server.send(400, "text/plain", "Missing cmd param");
  }
}

void setup() {
  Serial.begin(115200); 
  
  ESP32PWM::allocateTimer(0);
  ESP32PWM::allocateTimer(1);
  ESP32PWM::allocateTimer(2);
  ESP32PWM::allocateTimer(3);

  WiFi.begin(ssid, password);
  Serial.print("Dang ket noi WiFi...");
  int retry = 0;
  while (WiFi.status() != WL_CONNECTED && retry < 20) {
    delay(500);
    Serial.print(".");
    retry++;
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\nWiFi da ket noi!");
    Serial.print("Dia chi IP ESP32: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\nKhong the ket noi WiFi, tiep tuc che do Serial offline.");
  }

  server.on("/control", handleControl);
  server.begin();

  Serial.println("==========================================");
  Serial.println("DANG TEST KHOI DONG 3 SERVO...");
  runServo(servoInsert, pinInsert, 0, 500); 
  runServo(servoSwipe, pinSwipe, 0, 500);   
  runServoAngle(0); // Đưa SG90 về góc 0 độ ban đầu
  Serial.println("SAN SANG! Lenh: l2, r2, a2, b2 (ho tro float: a0.5, l0.8) | SG90: g[0-180], n[0-180]");
  Serial.println("==========================================");
}

void loop() {
  server.handleClient(); 

  if (Serial.available() > 0) {
    String input = Serial.readStringUntil('\n'); 
    processCommand(input);
  }
}
