import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["AI Test Cases"])

_client = None


def get_openai_client():
    global _client
    if _client is None:
        try:
            from openai import OpenAI
            api_key = os.environ.get("OPENAI_API_KEY")
            if api_key:
                _client = OpenAI(api_key=api_key)
        except Exception as e:
            logger.warning("OpenAI client init failed: %s", e)
    return _client


class GenerateTestCaseRequest(BaseModel):
    prompt: str = Field(..., description="User natural language test requirements")
    device_type: Optional[str] = "smartphone"
    context: Optional[str] = None
    existing_elements: Optional[List[str]] = None


class TestStep(BaseModel):
    id: int
    action: str = Field("CLICK", description="Action type: CLICK, TYPE, WAIT, VERIFY")
    target: str = Field(..., description="Target UI element label or description")
    value: Optional[str] = Field("", description="Input text value or parameter if TYPE action")
    delay_ms: int = Field(500, description="Delay after action in milliseconds")
    description: Optional[str] = ""
    status: str = Field("idle", description="idle, running, passed, failed")
    cnc_x: Optional[float] = Field(None, description="Physical CNC coordinate X")
    cnc_y: Optional[float] = Field(None, description="Physical CNC coordinate Y")


class GenerateTestCaseResponse(BaseModel):
    success: bool
    test_name: str
    description: str
    steps: List[TestStep]


def _rule_based_fallback(prompt: str) -> List[Dict[str, Any]]:
    """Fast offline fallback generator for common test cases like login and input forms."""
    prompt_lower = prompt.lower()
    steps = []

    if "facebook" in prompt_lower or "fb" in prompt_lower or "login" in prompt_lower or "đăng nhập" in prompt_lower:
        email_match = re.search(r"[\w\.-]+@[\w\.-]+|\b0\d{9,10}\b", prompt)
        email_val = email_match.group(0) if email_match else "user@example.com"

        pass_match = re.search(r"(?:pass|mật khẩu|mat khau)\s*[:=]?\s*([a-zA-Z0-9_@#$]+)", prompt, re.IGNORECASE)
        pass_val = pass_match.group(1) if pass_match else "123456"

        steps = [
            {
                "id": 1,
                "action": "CLICK",
                "target": "Email / Phone Input Field",
                "value": email_val,
                "delay_ms": 600,
                "description": f"Tap account input field and type '{email_val}'",
                "status": "idle",
            },
            {
                "id": 2,
                "action": "CLICK",
                "target": "Password Input Field",
                "value": pass_val,
                "delay_ms": 600,
                "description": "Tap password field and type password",
                "status": "idle",
            },
            {
                "id": 3,
                "action": "CLICK",
                "target": "Login Button",
                "value": "",
                "delay_ms": 1200,
                "description": "Tap Login button to submit form",
                "status": "idle",
            },
            {
                "id": 4,
                "action": "VERIFY",
                "target": "Dashboard / Next Screen",
                "value": "",
                "delay_ms": 1000,
                "description": "Verify application navigation after login",
                "status": "idle",
            },
        ]
    elif "cắm thẻ" in prompt_lower or "insert card" in prompt_lower or "đút thẻ" in prompt_lower or "chèn thẻ" in prompt_lower:
        pin_match = re.search(r"(?:pin|mã pin|pass)\s*[:=]?\s*(\d{4,6})", prompt, re.IGNORECASE)
        pin_val = pin_match.group(1) if pin_match else "1234"
        steps = [
            {
                "id": 1,
                "action": "INSERT_CARD",
                "target": "ATM / POS Card Slot",
                "value": "2",
                "delay_ms": 1000,
                "description": "Cắm thẻ ngân hàng vào khe đọc thẻ bằng Servo (D33)",
                "status": "idle",
            },
            {
                "id": 2,
                "action": "TYPE",
                "target": "Keypad PIN",
                "value": pin_val,
                "delay_ms": 600,
                "description": f"Nhập mã PIN {pin_val} trên bàn phím",
                "status": "idle",
            },
            {
                "id": 3,
                "action": "CLICK",
                "target": "Enter / OK Button",
                "value": "",
                "delay_ms": 1200,
                "description": "Nhấn phím xác nhận giao dịch",
                "status": "idle",
            },
            {
                "id": 4,
                "action": "EJECT_CARD",
                "target": "ATM / POS Card Slot",
                "value": "2",
                "delay_ms": 800,
                "description": "Rút thẻ ra khỏi khe đọc bằng Servo (D33)",
                "status": "idle",
            },
        ]
    elif "quẹt thẻ" in prompt_lower or "swipe card" in prompt_lower or "swip card" in prompt_lower or "thẻ từ" in prompt_lower:
        steps = [
            {
                "id": 1,
                "action": "SWIPE_CARD",
                "target": "Magnetic Card Reader Slot",
                "value": "2",
                "delay_ms": 1000,
                "description": "Quẹt thẻ từ qua khe đọc bằng Servo (D12)",
                "status": "idle",
            },
            {
                "id": 2,
                "action": "CLICK",
                "target": "Confirm / OK Button",
                "value": "",
                "delay_ms": 1000,
                "description": "Nhấn nút xác nhận giao dịch thẻ từ",
                "status": "idle",
            },
            {
                "id": 3,
                "action": "VERIFY",
                "target": "Transaction Successful Screen",
                "value": "",
                "delay_ms": 1000,
                "description": "Kiểm tra màn hình thông báo thanh toán thành công",
                "status": "idle",
            },
        ]
    elif "thanh toán" in prompt_lower or "pos" in prompt_lower or "pay" in prompt_lower or "amount" in prompt_lower:
        steps = [
            {
                "id": 1,
                "action": "CLICK",
                "target": "Amount Input Field",
                "value": "50000",
                "delay_ms": 500,
                "description": "Tap amount field and input 50,000",
                "status": "idle",
            },
            {
                "id": 2,
                "action": "CLICK",
                "target": "Confirm / Pay Button",
                "value": "",
                "delay_ms": 1000,
                "description": "Tap confirm payment button",
                "status": "idle",
            },
        ]
    else:
        steps = [
            {
                "id": 1,
                "action": "CLICK",
                "target": "Target Element",
                "value": "",
                "delay_ms": 600,
                "description": prompt,
                "status": "idle",
            }
        ]

    return steps


@router.post("/generate-testcases", response_model=GenerateTestCaseResponse)
def generate_test_cases(req: GenerateTestCaseRequest):
    user_prompt = (req.prompt or "").strip()
    if not user_prompt:
        raise HTTPException(status_code=400, detail="Please enter a test scenario description")

    client = get_openai_client()
    if client:
        try:
            system_msg = (
                "You are an industrial QA Automation Lead for hardware test rigs (CNC robot stylus touching smartphones, POS, ATM keypads, and dual 360-degree servo card feeder).\n"
                "Convert the user's natural language test requirement into a sequential, actionable test script.\n"
                "Available Actions:\n"
                "- 'CLICK': touch target element on screen/keypad\n"
                "- 'TYPE': input text into target field\n"
                "- 'WAIT': pause execution for specified delay\n"
                "- 'VERIFY': verify UI state or screen message\n"
                "- 'INSERT_CARD': insert ATM/chip card into card slot using Servo 360 (D33)\n"
                "- 'EJECT_CARD': eject/retract card out of card slot using Servo 360 (D33)\n"
                "- 'SWIPE_CARD': swipe magnetic card through swipe slot using Servo 360 (D12)\n"
                "Target names must be clear, concise English UI element names (e.g. 'Email / Phone Field', 'Password Field', 'Card Slot', 'Key 1', 'Cancel Button').\n"
                "Return JSON ONLY matching this exact structure:\n"
                "{\n"
                '  "test_name": "Test Scenario Name (e.g. POS Card Payment Flow)",\n'
                '  "description": "Brief summary of the test objective",\n'
                '  "steps": [\n'
                '    {\n'
                '      "id": 1,\n'
                '      "action": "INSERT_CARD",\n'
                '      "target": "POS Card Slot",\n'
                '      "value": "2",\n'
                '      "delay_ms": 1000,\n'
                '      "description": "Insert smart card into POS slot",\n'
                '      "status": "idle"\n'
                '    }\n'
                '  ]\n'
                "}\n"
                "Do NOT include markdown backticks or explanation text."
            )

            context_info = f"Existing detected targets: {req.existing_elements}" if req.existing_elements else ""
            full_user_content = f"Yêu cầu kịch bản: {user_prompt}\n{context_info}"

            resp = client.chat.completions.create(
                model="gpt-4o-mini",
                temperature=0.2,
                messages=[
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": full_user_content},
                ],
            )
            raw_content = (resp.choices[0].message.content or "").strip()
            cleaned = re.sub(r"^```(?:json)?\s*", "", raw_content, flags=re.MULTILINE)
            cleaned = re.sub(r"\s*```$", "", cleaned, flags=re.MULTILINE).strip()
            data = json.loads(cleaned)

            steps_data = []
            for idx, s in enumerate(data.get("steps", [])):
                steps_data.append(
                    TestStep(
                        id=idx + 1,
                        action=str(s.get("action", "CLICK")).upper(),
                        target=str(s.get("target", f"Phần tử {idx + 1}")),
                        value=str(s.get("value", "")),
                        delay_ms=int(s.get("delay_ms", 600)),
                        description=str(s.get("description", "")),
                        status="idle",
                        cnc_x=float(s["cnc_x"]) if s.get("cnc_x") is not None else None,
                        cnc_y=float(s["cnc_y"]) if s.get("cnc_y") is not None else None,
                    )
                )

            return GenerateTestCaseResponse(
                success=True,
                test_name=str(data.get("test_name", "Kịch bản Kiểm Thử Tự Động")),
                description=str(data.get("description", user_prompt)),
                steps=steps_data,
            )
        except Exception as exc:
            logger.warning("OpenAI testcase generation failed, falling back to rule parser: %s", exc)

    # Fallback to local rule-based parser
    fallback_steps = _rule_based_fallback(user_prompt)
    return GenerateTestCaseResponse(
        success=True,
        test_name="Kịch bản Kiểm Thử Tự Động (Offline Generator)",
        description=user_prompt,
        steps=[TestStep(**s) for s in fallback_steps],
    )
