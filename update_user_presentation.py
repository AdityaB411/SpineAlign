import shutil
from pptx import Presentation

src_path = r"C:\Users\PHY HOD\.gemini\antigravity\brain\f50b7417-b546-462f-af0e-ba9fb8fcf1b6\.user_uploaded\media_1794928841350_ab67d8a2.pptx"
dst_path = r"e:\SpineAlign\SpineAlign_Final_Presentation.pptx"

# Copy original file first to preserve all master slides, layouts, themes, logos, fonts, dimensions
shutil.copy2(src_path, dst_path)

prs = Presentation(dst_path)

def update_run_text(paragraph, new_text):
    if paragraph.runs:
        paragraph.runs[0].text = new_text
        # Remove any extra runs if they exist
        for r in paragraph.runs[1:]:
            r.text = ""
    else:
        paragraph.text = new_text

# -----------------------------------------------------------------------------
# SLIDE 9 (Student 3: Communication & Architecture)
# -----------------------------------------------------------------------------
s9 = prs.slides[8]
shape7_s9 = s9.shapes[7]
update_run_text(
    shape7_s9.text_frame.paragraphs[2],
    "Our fix: intended real-hardware link is Bluetooth Low Energy (BLE) between the ESP32 and the Web Ergonomic Dashboard — no Wi-Fi, no cloud"
)
update_run_text(
    shape7_s9.text_frame.paragraphs[4],
    "The haptic alert still fires even if the dashboard is unlinked or out of range; the dashboard owns 3D posture visualizer, calibration UI, and posture history"
)

# -----------------------------------------------------------------------------
# SLIDE 10 (System Architecture & Data Flow Diagram)
# -----------------------------------------------------------------------------
s10 = prs.slides[9]
# Shape 8: ESP32 box
update_run_text(s10.shapes[8].text_frame.paragraphs[0], "ESP32-WROOM")

# Shape 10: Haptic Motor box
update_run_text(s10.shapes[10].text_frame.paragraphs[2], "dashboard is out of range")

# Shape 12: Bluetooth SPP box
update_run_text(s10.shapes[12].text_frame.paragraphs[1], "BLE (GATT)")

# Shape 13: Companion Android App box -> Web Ergonomic Dashboard
update_run_text(s10.shapes[13].text_frame.paragraphs[0], "Web Ergonomic Dashboard")
update_run_text(s10.shapes[13].text_frame.paragraphs[1], "3D Digital Twin / Calibration UI /")
update_run_text(s10.shapes[13].text_frame.paragraphs[2], "Posture History")

# -----------------------------------------------------------------------------
# SLIDE 11 (Student 4: Feedback & Presentation Interface)
# -----------------------------------------------------------------------------
s11 = prs.slides[10]
shape7_s11 = s11.shapes[7]
update_run_text(
    shape7_s11.text_frame.paragraphs[3],
    "For the presentation build: added an on-device SSD1306 OLED display and a real-time Web Bluetooth 3D particle human model showing live neck/back bend and sideways twist"
)

# -----------------------------------------------------------------------------
# SLIDE 12 (Hardware Plan vs. Implementation Table)
# -----------------------------------------------------------------------------
s12 = prs.slides[11]
# Title
update_run_text(s12.shapes[5].text_frame.paragraphs[0], "Hardware Plan vs. Implementation: What Changed, and Why")

# Table
table = s12.shapes[6].table
def set_cell(r, c, txt):
    cell = table.cell(r, c)
    if cell.text_frame.paragraphs:
        update_run_text(cell.text_frame.paragraphs[0], txt)
    else:
        cell.text = txt

set_cell(0, 2, "Physical Implementation")

set_cell(1, 1, "ESP32-CAM (initial plan)")
set_cell(1, 2, "ESP32-WROOM DevKit")
set_cell(1, 3, "Standard I2C pins, built-in BLE, robust dual-core")

set_cell(2, 2, "Vibration motor + status LED")
set_cell(2, 3, "Tactile feedback with visual status confirmation")

set_cell(3, 2, "Web Dashboard + SSD1306 OLED")
set_cell(3, 3, "Interactive 3D digital twin plus on-device OLED")

set_cell(4, 2, "BOOT button & Web BLE command")
set_cell(4, 3, "Hardware button or one-click dashboard trigger")

set_cell(5, 1, "Bluetooth Classic SPP (initial)")
set_cell(5, 2, "Bluetooth Low Energy (BLE)")
set_cell(5, 3, "Web Bluetooth directly in Chrome/Edge, zero install")

set_cell(6, 2, "TP4056 + 3.7V LiPo (500mAh)")
set_cell(6, 3, "Autonomous battery power with >11.9 hours runtime")

# -----------------------------------------------------------------------------
# SLIDE 13 (Student 5: Hardware Integration)
# -----------------------------------------------------------------------------
s13 = prs.slides[12]
shape7_s13 = s13.shapes[7]
update_run_text(
    shape7_s13.text_frame.paragraphs[1],
    "Full hardware bill of materials: ESP32-WROOM-32, dual MPU6050, TP4056 charging module, 3.7V Li-ion/LiPo battery, haptic vibration motor"
)

# -----------------------------------------------------------------------------
# SLIDE 15 (Conclusion & Future Work)
# -----------------------------------------------------------------------------
s15 = prs.slides[14]
shape6_s15 = s15.shapes[6]
update_run_text(
    shape6_s15.text_frame.paragraphs[0],
    "SpineAlign Lite: a dual-IMU, Kalman-filtered, hysteresis-gated posture monitor — validated live with ESP32-WROOM & 3D dashboard"
)
update_run_text(
    shape6_s15.text_frame.paragraphs[2],
    "This physical prototype build proves the core engineering works end to end"
)
update_run_text(
    shape6_s15.text_frame.paragraphs[3],
    "Future work: on-device TinyML posture classification, surface EMG (sEMG) muscle fatigue integration, and smart activewear"
)

prs.save(dst_path)
print("Updated presentation saved successfully to:", dst_path)
