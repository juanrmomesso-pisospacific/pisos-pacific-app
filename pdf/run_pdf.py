import sys, json
from pacific_pdf import generate_pdf
data = json.load(sys.stdin)
sys.stdout.buffer.write(generate_pdf(data))
