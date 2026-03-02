import psycopg2
import tkinter as tk
from tkinter import ttk, messagebox

# بيانات الاتصال بقاعدة البيانات
DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "user": "postgres",
    "password": "كلمة_المرور",  # ← غيّرها حسب إعدادك
    "database": "my_app_db"
}

# إنشاء جدول users إذا ما كان موجود
def create_table():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100),
            email VARCHAR(100),
            age INTEGER
        );
    """)
    conn.commit()
    cur.close()
    conn.close()

# إدخال مستخدم جديد
def insert_user(name, email, age):
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO users (name, email, age) VALUES (%s, %s, %s);",
        (name, email, age)
    )
    conn.commit()
    cur.close()
    conn.close()

# عرض جميع المستخدمين
def fetch_users():
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor()
    cur.execute("SELECT id, name, email, age FROM users;")
    rows = cur.fetchall()
    cur.close()
    conn.close()
    return rows

# إنشاء واجهة المستخدم
def create_gui():
    def add_user():
        name = name_entry.get()
        email = email_entry.get()
        age = age_entry.get()

        if not (name and email and age.isdigit()):
            messagebox.showerror("خطأ", "الرجاء إدخال جميع البيانات بشكل صحيح.")
            return

        insert_user(name, email, int(age))
        messagebox.showinfo("تم", f"تمت إضافة {name} بنجاح.")
        name_entry.delete(0, tk.END)
        email_entry.delete(0, tk.END)
        age_entry.delete(0, tk.END)
        refresh_users()

    def refresh_users():
        for row in tree.get_children():
            tree.delete(row)
        for user in fetch_users():
            tree.insert("", tk.END, values=user)

    root = tk.Tk()
    root.title("إدارة المستخدمين - PostgreSQL")

    tk.Label(root, text="الاسم:").grid(row=0, column=0, padx=5, pady=5)
    name_entry = tk.Entry(root)
    name_entry.grid(row=0, column=1, padx=5, pady=5)

    tk.Label(root, text="الإيميل:").grid(row=1, column=0, padx=5, pady=5)
    email_entry = tk.Entry(root)
    email_entry.grid(row=1, column=1, padx=5, pady=5)

    tk.Label(root, text="العمر:").grid(row=2, column=0, padx=5, pady=5)
    age_entry = tk.Entry(root)
    age_entry.grid(row=2, column=1, padx=5, pady=5)

    tk.Button(root, text="إضافة", command=add_user).grid(row=3, column=0, columnspan=2, pady=10)

    tree = ttk.Treeview(root, columns=("ID", "الاسم", "الإيميل", "العمر"), show="headings")
    tree.heading("ID", text="ID")
    tree.heading("الاسم", text="الاسم")
    tree.heading("الإيميل", text="الإيميل")
    tree.heading("العمر", text="العمر")
    tree.grid(row=4, column=0, columnspan=2, padx=10, pady=10)

    refresh_users()
    root.mainloop()

# شغل البرنامج
if __name__ == "__main__":
    create_table()
    create_gui()
