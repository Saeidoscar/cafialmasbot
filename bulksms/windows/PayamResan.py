"""PayamResan Desktop — نقطهٔ ورود (هم برای اجرای مستقیم و هم برای ساخت EXE)."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from payamresan.app import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(sys.argv))
