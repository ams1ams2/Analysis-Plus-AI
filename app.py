"""
app.py | تحليل بلس – نظام عام لتحليل المعلومات بشكل فوري
--------------------------------------------------------
• FALLBACK إلى SQLite إذا فشل DATABASE_URL
• حفظ سجل الاستعلامات بشكل دائم
• OpenRouter: اختيار أي نموذج من النماذج المتاحة
"""

import os, secrets, datetime, sqlite3, random, re, json, uuid, tempfile
from flask import Flask, render_template, request, jsonify, session, stream_with_context, Response
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import create_engine, MetaData, text
from dotenv import load_dotenv
import requests
from faker import Faker

# ─── OpenRouter فقط (بدون مكتبة OpenAI) ───────────
load_dotenv()
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"

# قائمة نماذج OpenRouter (المستخدم يختار أي نموذج)
OPENROUTER_MODELS = [
    {"id": "openai/gpt-4o", "name": "GPT-4o (OpenAI)"},
    {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini (OpenAI)"},
    {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet (Anthropic)"},
    {"id": "anthropic/claude-3-haiku", "name": "Claude 3 Haiku (Anthropic)"},
    {"id": "google/gemini-2.0-flash-001", "name": "Gemini 2.0 Flash (Google)"},
    {"id": "google/gemini-pro-1.5", "name": "Gemini Pro 1.5 (Google)"},
    {"id": "meta-llama/llama-3.1-70b-instruct", "name": "Llama 3.1 70B (Meta)"},
    {"id": "meta-llama/llama-3.1-8b-instruct", "name": "Llama 3.1 8B (Meta)"},
]
DEFAULT_OPENROUTER_MODEL = "openai/gpt-4o"


def openrouter_chat(model, messages, temperature=0, stream=False):
    """استدعاء OpenRouter عبر HTTP فقط (بدون openai)."""
    if not OPENROUTER_API_KEY:
        return None
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": request.url_root.strip("/") or "https://localhost",
    }
    payload = {"model": model, "messages": messages, "temperature": temperature, "stream": stream}
    r = requests.post(OPENROUTER_URL, headers=headers, json=payload, timeout=120, stream=stream)
    r.raise_for_status()
    return r


def openrouter_chat_stream(model, messages, temperature=0.7):
    """مولد نصوص من استجابة OpenRouter (SSE)."""
    r = openrouter_chat(model, messages, temperature=temperature, stream=True)
    if r is None:
        return
    r.encoding = "utf-8"  # ضمان قراءة النص العربي بشكل صحيح
    for line in r.iter_lines(decode_unicode=True):
        if not line or not line.startswith("data: "):
            continue
        data = line[6:].strip()
        if data == "[DONE]":
            break
        try:
            obj = json.loads(data)
            delta = (obj.get("choices") or [{}])[0].get("delta") or {}
            content = delta.get("content") or ""
            if content:
                yield content
        except (json.JSONDecodeError, IndexError, KeyError):
            continue


import pandas as pd
import numpy as np
from sdv.single_table import GaussianCopulaSynthesizer
from sdv.metadata import SingleTableMetadata
import arabic_reshaper
from bidi.algorithm import get_display

# ─── إعداد البيئة ───────────────────────────

app = Flask(__name__, template_folder="templates")
app.secret_key = secrets.token_hex(16)

# FALLBACK: جرّب DATABASE_URL أولاً
raw_db = os.getenv("DATABASE_URL", "")
custom_uri = os.getenv("CUSTOM_DATABASE_URL") # اقرأ URI المخصص من .env
def try_connect(uri):
    try:
        create_engine(uri, future=True).connect().close()
        return True
    except:
        return False

# استخدم URI المخصص إذا كان موجودًا في .env
if custom_uri and try_connect(custom_uri):
    app.config["SQLALCHEMY_DATABASE_URI"] = custom_uri
elif raw_db and try_connect(raw_db):
    app.config["SQLALCHEMY_DATABASE_URI"] = raw_db
else:
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///prod.db"

app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
db = SQLAlchemy(app)

DEMO_URI = os.getenv("DEMO_DATABASE_URI", "sqlite:///mock.db")

# دالة لحفظ متغير في ملف .env
def save_to_env(key, value):
    # قد تحتاج مكتبة python-dotenv لكتابة .env بشكل صحيح
    # الطريقة المبسطة: فتح الملف وإضافة السطر
    try:
        with open('.env', 'a') as f:
            f.write(f'\n{key}={value}')
    except Exception as e:
        print(f"Error saving to .env: {e}")

# دالة لحذف متغير من ملف .env
def remove_from_env(key):
    try:
        with open('.env', 'r') as f:
            lines = f.readlines()
        with open('.env', 'w') as f:
            for line in lines:
                if not line.strip().startswith(f'{key}='):
                    f.write(line)
    except Exception as e:
        print(f"Error removing from .env: {e}")

# ─── نموذج سجل الاستعلامات ────────────────────
class QueryHistory(db.Model):
    id        = db.Column(db.Integer, primary_key=True)
    question  = db.Column(db.String, nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.datetime.utcnow)

with app.app_context():
    db.create_all()

# ─── تهيئة mock.db إن لزم ─────────────────────
def init_demo():
    path = DEMO_URI.replace("sqlite:///","")
    if os.path.exists(path): return
    import faker, datetime as dt
    fk,depts = faker.Faker(), ['Cardiology','Emergency','Pediatrics','Oncology']
    con = sqlite3.connect(path)
    con.execute("""
      CREATE TABLE patient_visits(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_name TEXT, age INTEGER,
        visit_datetime TEXT, department TEXT, doctor_name TEXT
      )
    """)
    rows = [
      (fk.name(), random.randint(1,90),
       (dt.datetime.utcnow()-dt.timedelta(days=random.randint(0,30))).isoformat(' '),
       random.choice(depts), fk.name())
      for _ in range(60)
    ]
    con.executemany("""
      INSERT INTO patient_visits(patient_name,age,visit_datetime,department,doctor_name)
      VALUES(?,?,?,?,?)
    """, rows)
    con.commit(); con.close()
init_demo()

# ─── أدوات قاعدة ───────────────────────────────
def engine_from_uri(uri):
    return create_engine(uri, future=True, echo=False)

def get_engine(demo=False):
    if session.get("custom_uri"):
        return engine_from_uri(session["custom_uri"])
    if demo or session.get("demo_mode"):
        return engine_from_uri(DEMO_URI)
    return engine_from_uri(app.config["SQLALCHEMY_DATABASE_URI"])

def reflect_schema(engine):
    meta = MetaData(); meta.reflect(bind=engine)
    return "\n".join(
        f"{t.name}({', '.join(c.name for c in t.columns)})"
        for t in meta.sorted_tables
    )

def strip_sql(sql: str) -> str:
    # إزالة fences ```sql``` إن وجدت
    if sql.startswith("```"):
        parts = sql.splitlines()
        if parts[0].startswith("```"): parts = parts[1:]
        if parts and parts[-1].startswith("```"): parts = parts[:-1]
        sql = "\n".join(parts)
    # إزالة backticks أحادية
    return sql.strip("`\n ")

# ─── توليد بيانات وهمية باستخدام SDV ───────────────────────────────
def detect_column_type(df, column):
    """
    دالة مساعدة لتحديد نوع العمود بشكل دقيق
    """
    # الحصول على عينة من البيانات
    sample = df[column].dropna().iloc[0] if not df[column].empty else None
    
    # التحقق من نوع البيانات
    if column.lower() == 'id':
        return None  # تخطي عمود ID
        
    # التحقق من الأسماء
    if 'name' in column.lower():
        return 'categorical'
        
    # التحقق من التواريخ والأوقات
    if isinstance(sample, str):
        if re.match(r'\d{4}-\d{2}-\d{2}', str(sample)):  # تاريخ
            return 'datetime'
        elif re.match(r'\d{2}:\d{2}:\d{2}', str(sample)):  # وقت
            return 'datetime'
        elif re.match(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}', str(sample)):  # تاريخ ووقت
            return 'datetime'
    
    # التحقق من الأرقام
    if pd.api.types.is_numeric_dtype(df[column]):
        if df[column].dtype in ['int64', 'int32']:
            return 'numerical'
        else:
            return 'numerical'
            
    # التحقق من القيم الفريدة
    unique_ratio = df[column].nunique() / len(df)
    if unique_ratio < 0.1:  # إذا كانت القيم الفريدة أقل من 10%
        return 'categorical'
        
    return 'categorical'  # النوع الافتراضي

def generate_synthetic_data(original_data, num_samples=3):
    """
    توليد بيانات وهمية باستخدام SDV مع الحفاظ على الخصائص الإحصائية للبيانات الأصلية
    """
    if not original_data:
        return []
    
    # تحويل البيانات إلى DataFrame
    df = pd.DataFrame(original_data)
    
    # طباعة معلومات عن البيانات
    print("\nمعلومات عن البيانات الأصلية:")
    print("الأعمدة:", df.columns.tolist())
    print("أنواع البيانات:")
    for col in df.columns:
        print(f"- {col}: {df[col].dtype}")
    
    # إنشاء metadata للبيانات
    metadata = SingleTableMetadata()
    
    # تحديد أنواع الأعمدة بشكل دقيق
    for column in df.columns:
        column_type = detect_column_type(df, column)
        if column_type:  # تخطي الأعمدة التي تم تحديدها كـ None
            metadata.add_column(column, sdtype=column_type)
            print(f"تم تحديد نوع العمود {column} كـ {column_type}")
    
    # إنشاء المودل
    synthesizer = GaussianCopulaSynthesizer(metadata)
    
    # إزالة عمود ID قبل التدريب
    df_without_id = df.drop('id', axis=1) if 'id' in df.columns else df
    
    # طباعة معلومات عن البيانات المستخدمة للتدريب
    print("\nمعلومات عن البيانات المستخدمة للتدريب:")
    print("الأعمدة:", df_without_id.columns.tolist())
    
    # تدريب المودل
    synthesizer.fit(df_without_id)
    
    # توليد البيانات الجديدة
    synthetic_data = synthesizer.sample(num_samples)
    
    # إضافة عمود ID جديد
    if 'id' in df.columns:
        synthetic_data['id'] = range(1, len(synthetic_data) + 1)
    
    # طباعة معلومات عن البيانات المولدة
    print("\nمعلومات عن البيانات المولدة:")
    print("الأعمدة:", synthetic_data.columns.tolist())
    print("عدد الصفوف:", len(synthetic_data))
    
    # تحويل البيانات إلى قائمة من القواميس
    result = synthetic_data.to_dict('records')
    
    # معالجة الأسماء العربية
    arabic_names = [
        "أحمد محمد", "علي حسن", "محمد علي", "خالد عبدالله", "عمر محمد",
        "فاطمة أحمد", "سارة محمد", "نورا علي", "ليلى خالد", "منى أحمد"
    ]
    
    # استبدال الأسماء بأسماء عربية
    for row in result:
        for key in row:
            if 'name' in key.lower():
                row[key] = random.choice(arabic_names)
    
    return result

# ─── عينات عشوائية ─────────────────────────────
@app.route("/api/sample")
def api_sample():
    demo = request.args.get("demo", "0").lower() in ("1", "true", "yes")
    eng = get_engine(demo=demo)
    tbl = reflect_schema(eng).split("(")[0].strip()
    
    with eng.connect() as con:
        # جلب عينة من البيانات الأصلية
        original_rows = con.execute(text(
            f"SELECT * FROM {tbl} ORDER BY RANDOM() LIMIT 10"
        )).mappings().all()
        
        if not original_rows:
            return jsonify({"error": "لا توجد بيانات في الجدول"}), 404
            
        # توليد بيانات وهمية باستخدام SDV
        rows = generate_synthetic_data([dict(r) for r in original_rows])
    
    warning = ""
    if not demo and not session.get("demo_mode"):
        warning = (
          "⚠️ بيانات حقيقية، يُفضّل تعديلها إلى وهمية للفهم فقط."
        )
    return jsonify({
        "warning": warning,
        "sample": rows
    })

# ─── شكل البيانات الأساسية (Schema + عينة تدريجية + معلومات توضيحية) ─────────
SAMPLE_PAGE_SIZE = 300

@app.route("/api/data_shape", methods=["GET"])
def api_data_shape():
    """إرجاع شكل البيانات: عدد الصفوف، الأعمدة وأنواعها، وعينة أولى (مثلاً 300 صف)."""
    demo = request.args.get("demo", "0").lower() in ("1", "true", "yes")
    try:
        eng = get_engine(demo=demo)
        schema_str = reflect_schema(eng)
        meta = MetaData()
        meta.reflect(bind=eng)
        tables = list(meta.sorted_tables)
        if not tables:
            return jsonify({"error": "لا توجد جداول", "schema": "", "tables": [], "sample": []}), 404
        tbl = tables[0]
        cols = [c.name for c in tbl.columns]
        col_types = {c.name: str(c.type) for c in tbl.columns}
        with eng.connect() as con:
            total = con.execute(text(f"SELECT COUNT(*) FROM {tbl.name}")).scalar() or 0
            rows = con.execute(text(f"SELECT * FROM {tbl.name} LIMIT {SAMPLE_PAGE_SIZE}")).mappings().all()
        sample = [dict(r) for r in rows]
        return jsonify({
            "schema": schema_str,
            "table_name": tbl.name,
            "columns": cols,
            "column_types": col_types,
            "total_row_count": total,
            "sample": sample,
            "row_count_preview": len(sample),
        })
    except Exception as e:
        return jsonify({"error": str(e), "schema": "", "tables": [], "sample": []}), 500

@app.route("/api/data_shape_sample", methods=["GET"])
def api_data_shape_sample():
    """جلب دفعة إضافية من الصفوف (للتمرير التدريجي)."""
    demo = request.args.get("demo", "0").lower() in ("1", "true", "yes")
    offset = max(0, int(request.args.get("offset", 0)))
    limit = min(500, max(1, int(request.args.get("limit", SAMPLE_PAGE_SIZE))))
    try:
        eng = get_engine(demo=demo)
        meta = MetaData()
        meta.reflect(bind=eng)
        tables = list(meta.sorted_tables)
        if not tables:
            return jsonify({"rows": []}), 404
        tbl = tables[0]
        with eng.connect() as con:
            rows = con.execute(text(f"SELECT * FROM {tbl.name} LIMIT {limit} OFFSET {offset}")).mappings().all()
        return jsonify({"rows": [dict(r) for r in rows]})
    except Exception as e:
        return jsonify({"rows": [], "error": str(e)}), 500

# ─── قائمة نماذج OpenRouter (للواجهة) ─────────────
@app.route("/api/models", methods=["GET"])
def api_models():
    return jsonify({"models": OPENROUTER_MODELS, "default": DEFAULT_OPENROUTER_MODEL})

# ─── قوالب ────────────────────────────────────
@app.context_processor
def inject_year():
    return {"current_year": datetime.datetime.utcnow().year}

@app.route("/")
def landing():
    return render_template("landing.html")

@app.route("/play")
@app.route("/index")
def index():
    return render_template("index.html")

@app.route("/chat")
def chat():
    return render_template("chat.html")

@app.route('/contact')
def contact():
    return render_template('contact.html')

@app.route('/about')
def about():
    return render_template('about.html')

# ─── تبديل demo/real ───────────────────────────
@app.route("/toggle", methods=["POST"])
def toggle():
    session["demo_mode"] = bool(request.json.get("demo", False))
    return jsonify({"mode": "demo" if session["demo_mode"] else "real"})

# ─── ربط URI خارجي ─────────────────────────────
@app.route("/api/connect", methods=["POST"])
def api_connect():
    data = request.json
    host = data.get("host")
    port = data.get("port")
    user = data.get("user")
    password = data.get("password")
    db_name = data.get("db_name")

    if not all([host, port, user, db_name]):
        return jsonify({"error":"الرجاء إدخال جميع بيانات الاتصال."}), 400

    # بناء URI من البيانات المدخلة
    uri = f"postgresql://{user}:{password}@{host}:{port}/{db_name}"

    if not try_connect(uri):
        return jsonify({"error":"فشل الاتصال بالبيانات المدخلة. الرجاء التأكد من صحتها."}), 400

    # حفظ URI في .env ليبقى الاتصال محفوظًا
    # save_to_env("CUSTOM_DATABASE_URL", uri)
    # حفظ URI في الجلسة للاستخدام الفوري
    session["custom_uri"] = uri

    # سحب عينات من البيانات وتوليد بيانات وهمية
    try:
        eng = engine_from_uri(uri)
        tbl = reflect_schema(eng).split("(")[0].strip()
        with eng.connect() as con:
            # جلب عينة من البيانات الأصلية
            original_rows = con.execute(text(
                f"SELECT * FROM {tbl} ORDER BY RANDOM() LIMIT 10"
            )).mappings().all()
            
            if original_rows:
                # توليد بيانات وهمية باستخدام SDV
                sample_data = generate_synthetic_data([dict(r) for r in original_rows])
                # حفظ العينات في الجلسة
                session["sample_data"] = sample_data
                return jsonify({
                    "status": "connected",
                    "uri": uri,
                    "sample_data": sample_data
                })
    except Exception as e:
        print(f"Error fetching samples: {e}")
        # حتى لو فشل سحب العينات، نستمر في الاتصال
        return jsonify({"status":"connected", "uri": uri})

    return jsonify({"status":"connected", "uri": uri})

# ─── سؤال → SQL → تنفيذ + سجل ───────────────────
@app.route("/api/query", methods=["POST"])
def api_query():
    data     = request.json
    question = data.get("question","").strip()
    model    = data.get("model", DEFAULT_OPENROUTER_MODEL)  # معرّف OpenRouter (مثل openai/gpt-4o)
    demo     = bool(data.get("demo",False))
    sample   = data.get("sample")

    if not question:
        return jsonify({"error":"السؤال فارغ"}),400

    # احفظ في سجل
    qh = QueryHistory(question=question)
    db.session.add(qh); db.session.commit()

    eng    = get_engine(demo)
    schema = reflect_schema(eng)
    
    # استخدام العينات المحفوظة في الجلسة إذا كانت موجودة
    if not sample and session.get("sample_data"):
        sample = session["sample_data"]
    
    if sample:
        schema += f"\n\nSample:\n{sample[:3]}"

    try:
        # توليد SQL عبر OpenRouter (نظام عام لتحليل المعلومات بشكل فوري)
        use_llm = bool(OPENROUTER_API_KEY and model)
        if use_llm:
            db_type = eng.dialect.name
            date_format_instruction = ""
            if db_type == 'sqlite':
                date_format_instruction = "Use strftime('%Y-%m-%d %H:%M') for formatting dates and times."
            elif db_type == 'postgresql':
                date_format_instruction = "Use TO_CHAR(column, 'YYYY-MM-DD HH24:MI') for formatting dates and times."

            prompt = (
              f"You are a general-purpose SQL analyst. Analyze the request and generate valid SQL for {db_type.capitalize()}. Use LIMIT, not TOP.\n"
              f"Schema:\n{schema}\n\n"
              f"Question: \"{question}\"\n"
              f"{date_format_instruction}\n"
              "Return only the SQL.\n"
              "After the SQL, on a new line, write: CHART: yes/no. If yes, suggest chart type (bar, line, pie, etc) and the best column for X axis and Y axis. Example: CHART: yes, bar, X=department, Y=age."
            )
            try:
                resp = openrouter_chat(model, [{"role":"user","content":prompt}], temperature=0, stream=False)
                if resp is None:
                    content = ""
                else:
                    data = resp.json()
                    content = (data.get("choices") or [{}])[0].get("message", {}).get("content") or ""
            except Exception as e:
                print(f"OpenRouter error: {e}")
                content = ""
            if not (content and content.strip()):
                sql = "SELECT 1;"
                chart_needed = False
                chart_type = None
                x_col = None
                y_col = None
                chart_info = ""
            else:
                if "CHART:" in content:
                    sql_part, chart_part = content.split("CHART:", 1)
                    sql = strip_sql(sql_part)
                    chart_info = chart_part.strip().lower()
                else:
                    sql = strip_sql(content)
                    chart_info = ""
                chart_needed = False
                chart_type = None
                x_col = None
                y_col = None
                if chart_info.startswith("yes"):
                    chart_needed = True
                    m = re.match(r"yes\s*,?\s*([a-z]+)?\s*,?\s*x=([\w_]+)\s*,?\s*y=([\w_]+)", chart_info)
                    if m:
                        chart_type = m.group(1)
                        x_col = m.group(2)
                        y_col = m.group(3)
                    else:
                        m2 = re.match(r"yes\s*,?\s*([a-z]+)?", chart_info)
                        if m2:
                            chart_type = m2.group(1)
        else:
            sql = "-- No OpenRouter key or model\nSELECT 1;"
            chart_needed = False
            chart_type = None
            x_col = None
            y_col = None

        # TOP → LIMIT
        m = re.search(r"SELECT\s+TOP\s+(\d+)\s", sql, re.I)
        if m:
            n = m.group(1)
            sql = re.sub(r"SELECT\s+TOP\s+\d+\s","SELECT ",sql,flags=re.I)
            if "LIMIT" not in sql.upper():
                sql = sql.rstrip(";") + f" LIMIT {n};"
        sql = sql.strip().rstrip(";") + ";"

        # Handle date formatting function based on database type - This part might be less necessary now with better prompt
        if eng.dialect.name == 'postgresql':
            # Replace SQLite strftime with PostgreSQL TO_CHAR
            # This is a basic replacement. More complex strftime formats may need more sophisticated conversion.
            # Keeping this as a fallback but the prompt should ideally handle it.
            sql = sql.replace("strftime(',", "TO_CHAR(")
            # Add more specific replacements if needed based on common model errors
            sql = sql.replace("'%Y-%m-%d %H:%M'", "'YYYY-MM-DD HH24:MI'")
            sql = sql.replace("'%Y-%m-%d %H:%M:%S'", "'YYYY-MM-DD HH24:MI:SS'")
            sql = sql.replace("'%Y-%m-%d'", "'YYYY-MM-DD'")
            sql = sql.replace("'%H:%M'", "'HH24:MI'")

        # تنفيذ الاستعلام
        with eng.connect() as con:
            rs   = con.execute(text(sql))
            rows = [dict(r) for r in rs.mappings().all()]
            cols = rs.keys()

        # توصية رسم افتراضية (إذا لم يحددها المودل)
        if not chart_needed:
            auto = None
            if len(rows)>20:
                auto = "line"
            elif len(cols)==2 and all(isinstance(rows[0][c],(int,float)) for c in cols):
                auto = "scatter"
            else:
                auto = "bar"
            chart_needed = auto is not None
            chart_type = auto
            x_col = None
            y_col = None

        return jsonify({
            "sql":sql,
            "results":rows,
            "explain":f"أعاد {len(rows)} صفًا",
            "showChart": chart_needed,
            "chartType": chart_type,
            "xCol": x_col,
            "yCol": y_col
        })
    except Exception as e:
        print(f"Error processing query: {e}")
        return jsonify({"error":f"An error occurred: {str(e)}"}), 500

# ─── دردشة OpenRouter (نظام عام، أي نموذج) ────────
@app.route("/api/chat", methods=["POST"])
def api_chat():
    data = request.json or {}
    msg = data.get("message", "")
    model = data.get("model", DEFAULT_OPENROUTER_MODEL)
    system_prompt = (
        "أنت محلل بيانات خبير تعمل داخل أداة تحليل بيانات (تحليل بلس). "
        "مهمتك مساعدة المستخدم في فهم البيانات واستخلاص insights وتحفيزه على الاستكشاف. "
        "تجاوب بلغة المستخدم (العربية أو غيرها). استخدم أسلوباً راقياً، تحفيزياً ومدهشاً مع رموز تعبيرية مناسبة. "
        "اكتب بوضوح وبشكل تدريجي كما لو كنت تتحدث كلمة كلمة، وادعم إجاباتك بأمثلة وإيجاز مفيد."
    )
    if not OPENROUTER_API_KEY:
        def gen():
            yield "⚠️ لم يتم تعيين OPENROUTER_API_KEY في .env"
        return Response(stream_with_context(gen()), content_type='text/plain; charset=utf-8')

    def gen():
        for chunk in openrouter_chat_stream(
            model,
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": msg},
            ],
            temperature=0.7,
        ):
            yield chunk
    return Response(stream_with_context(gen()), content_type='text/plain; charset=utf-8')

# ─── رفع ملف Excel أو SQLite ───────────────────
UPLOAD_FOLDER = os.path.join(tempfile.gettempdir(), "tahleel_upload")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route("/api/upload_data", methods=["POST"])
def api_upload_data():
    """رفع ملف Excel (.xlsx, .xls) أو قاعدة SQLite (.db, .sqlite) من الجهاز."""
    if "file" not in request.files:
        return jsonify({"error": "لم يُرفع أي ملف."}), 400
    f = request.files["file"]
    if not f or not f.filename:
        return jsonify({"error": "لم يُختر ملف."}), 400
    ext = (os.path.splitext(f.filename)[1] or "").lower()
    try:
        if ext in (".xlsx", ".xls"):
            df = pd.read_excel(f)
            df = df.dropna(how="all").reset_index(drop=True)
            if df.empty:
                return jsonify({"error": "الملف فارغ أو لا يحتوي على صفوف."}), 400
            # أسماء أعمدة صالحة لـ SQL
            df.columns = [re.sub(r"[^\w]", "_", str(c)).strip("_") or f"col_{i}" for i, c in enumerate(df.columns)]
            fid = str(uuid.uuid4())[:8]
            path = os.path.join(UPLOAD_FOLDER, f"upload_{fid}.db")
            uri = f"sqlite:///{path}"
            eng = engine_from_uri(uri)
            with eng.begin() as con:
                df.to_sql("data", con, if_exists="replace", index=False)
            session["custom_uri"] = uri
            session["uploaded_file_path"] = path
            sample_list = df.head(10).to_dict("records")
            session["sample_data"] = sample_list
            return jsonify({"status": "ok", "message": "تم رفع ملف Excel بنجاح.", "rows": len(df), "columns": list(df.columns), "sample_data": sample_list})
        if ext in (".db", ".sqlite", ".sqlite3"):
            path = os.path.join(UPLOAD_FOLDER, f"upload_{uuid.uuid4().hex[:12]}.db")
            f.save(path)
            uri = f"sqlite:///{path}"
            if not try_connect(uri):
                os.remove(path)
                return jsonify({"error": "ملف SQLite غير صالح أو تالف."}), 400
            session["custom_uri"] = uri
            session["uploaded_file_path"] = path
            sample_list = None
            try:
                eng = engine_from_uri(uri)
                meta = MetaData()
                meta.reflect(bind=eng)
                tbl = meta.sorted_tables[0] if meta.sorted_tables else None
                if tbl:
                    with eng.connect() as con:
                        rows = con.execute(text(f"SELECT * FROM {tbl.name} LIMIT 10")).mappings().all()
                    sample_list = [dict(r) for r in rows]
                    session["sample_data"] = sample_list
            except Exception:
                session["sample_data"] = None
            return jsonify({"status": "ok", "message": "تم رفع قاعدة SQLite بنجاح.", "sample_data": sample_list})
        return jsonify({"error": "نوع الملف غير مدعوم. استخدم Excel (.xlsx, .xls) أو SQLite (.db, .sqlite)."}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─── التحقق من حالة الاتصال ───────────────────
@app.route("/api/connection_status", methods=["GET"])
def api_connection_status():
    is_connected = "custom_uri" in session
    return jsonify({"isConnected": is_connected})

# ─── قطع الاتصال ─────────────────────────────
@app.route("/api/disconnect", methods=["POST"])
def api_disconnect():
    session.pop("custom_uri", None)
    session.pop("sample_data", None)
    session.pop("uploaded_file_path", None)
    return jsonify({"status": "disconnected"})

# ─── تشغيل الخادم ───────────────────────────────────
if __name__=="__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)
