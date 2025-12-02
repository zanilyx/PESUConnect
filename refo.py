#!/usr/bin/env python3
"""
PESU Academy — Interactive CLI Scraper (Option B)

- Python 3.7+
- Uses internal AJAX endpoints (actionType 38,42,43,60,343) with menuId=653
- Interactive: choose semester -> subject -> unit -> classes -> range -> download
"""

import os
import re
import time
import requests
from bs4 import BeautifulSoup
from urllib.parse import urljoin
from tqdm import tqdm

BASE_URL = "https://www.pesuacademy.com"
LOGIN_PAGE = f"{BASE_URL}/Academy/"
LOGIN_POST = f"{BASE_URL}/Academy/j_spring_security_check"
SUBJECTS_URL = f"{BASE_URL}/Academy/s/studentProfilePESUAdmin"
MENU_ID = "653"

HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (compatible; PESU-Scraper/1.0)",
    "Referer": LOGIN_PAGE,
}

# ---------- Helpers ----------

def slugify(s):
    s = (s or "").strip()
    s = re.sub(r'[<>:"/\\|?*\n\r\t]+', "_", s)
    s = re.sub(r"\s+", "_", s)
    return s[:200] or "untitled"

def safe_mkdir(path):
    os.makedirs(path, exist_ok=True)

def download_file(session, url, dest_path):
    url = urljoin(BASE_URL, url)
    safe_mkdir(os.path.dirname(dest_path))
    try:
        with session.get(url, stream=True, timeout=60) as r:
            r.raise_for_status()
            total = r.headers.get("content-length")
            if total is None:
                with open(dest_path, "wb") as f:
                    for chunk in r.iter_content(8192):
                        if chunk:
                            f.write(chunk)
            else:
                total = int(total)
                with open(dest_path, "wb") as f, tqdm(total=total, unit="B", unit_scale=True, desc=os.path.basename(dest_path)) as pbar:
                    for chunk in r.iter_content(8192):
                        if chunk:
                            f.write(chunk)
                            pbar.update(len(chunk))
        return True
    except Exception as e:
        print("Download error:", e)
        return False

# ---------- Login & helpers ----------

def login(session, username, password):
    r = session.get(LOGIN_PAGE, headers=HEADERS_BASE, timeout=30)
    soup = BeautifulSoup(r.text, "html.parser")
    csrf = None
    m = soup.find("meta", {"name": "csrf-token"})
    if m and m.has_attr("content"):
        csrf = m["content"]
    if not csrf:
        token_input = soup.find("input", {"name": "_csrf"})
        if token_input and token_input.has_attr("value"):
            csrf = token_input["value"]
    headers = dict(HEADERS_BASE)
    if csrf:
        headers["X-CSRF-Token"] = csrf
    data = {"j_username": username, "j_password": password}
    resp = session.post(LOGIN_POST, data=data, headers=headers, allow_redirects=True, timeout=30)
    if resp.ok and ("studentProfilePESU".lower() in resp.url.lower() or "logout" in resp.text.lower()):
        print("[+] Login successful")
        return True
    print("[!] Login may have failed; status:", resp.status_code)
    return False

# ---------- Semesters ----------

def get_semesters(session):
    # endpoint returns <option> elements
    session.get(f"{BASE_URL}/Academy/s/studentProfilePESU", headers=HEADERS_BASE)
    resp = session.get(f"{BASE_URL}/Academy/a/studentProfilePESU/getStudentSemestersPESU", headers={"Referer": f"{BASE_URL}/Academy/s/studentProfilePESU"})
    soup = BeautifulSoup(resp.text, "html.parser")
    opts = []
    for opt in soup.find_all("option"):
        v = opt.get("value")
        if v:
            opts.append((v, opt.get_text(" ", strip=True)))
    return opts

# ---------- Subjects ----------

def get_subjects_html(session, sem_id):
    # Refresh CSRF
    prof = session.get(f"{BASE_URL}/Academy/s/studentProfilePESU", headers=HEADERS_BASE, timeout=30)
    soup = BeautifulSoup(prof.text, "html.parser")
    csrf = None
    m = soup.find("meta", {"name": "csrf-token"})
    if m and m.has_attr("content"):
        csrf = m["content"]
    headers = {
        "Referer": f"{BASE_URL}/Academy/s/studentProfilePESU",
        "X-Requested-With": "XMLHttpRequest",
    }
    if csrf:
        headers["X-CSRF-Token"] = csrf
    # POST actionType=38 to get subjects for semester
    data = {
        "controllerMode": "6403",
        "actionType": "38",
        "id": re.sub(r"[^0-9]", "", str(sem_id)),
        "menuId": MENU_ID,
        "_csrf": csrf or "",
    }
    r = session.post(SUBJECTS_URL, headers=headers, data=data, timeout=30)
    return r.text

def parse_subjects_with_course_ids(html):
    soup = BeautifulSoup(html, "html.parser")
    container = soup.find(id="getStudentSubjectsBasedOnSemesters") or soup
    table = container.find("table")
    if not table:
        return [], []
    headers = [th.get_text(" ", strip=True) for th in table.find_all("th")]
    items = []
    # extract course id from onclick like clickOnCourseContent('12345')
    onclick_re = re.compile(r"(clickoncoursecontent|clickOnCourseContent)\s*\(\s*'?\s*(\d+)\s*'?", re.IGNORECASE)
    for tr in table.find_all("tr"):
        tds = tr.find_all("td")
        if not tds:
            continue
        cells = [td.get_text(" ", strip=True) for td in tds]
        course_id = None
        m = onclick_re.search(str(tr))
        if m:
            course_id = m.group(2)
        items.append({"cells": cells, "course_id": course_id})
    return headers, items

# ---------- Course units (tabs) ----------

def get_course_content(session, course_id):
    # actionType=42 => course page (units)
    prof = session.get(f"{BASE_URL}/Academy/s/studentProfilePESU", headers=HEADERS_BASE, timeout=30)
    soup = BeautifulSoup(prof.text, "html.parser")
    csrf = None
    m = soup.find("meta", {"name": "csrf-token"})
    if m and m.has_attr("content"):
        csrf = m["content"]
    headers = {"Referer": f"{BASE_URL}/Academy/s/studentProfilePESU", "X-Requested-With": "XMLHttpRequest"}
    if csrf:
        headers["X-CSRF-Token"] = csrf
    r = session.get(SUBJECTS_URL, params={
        "controllerMode": "6403",
        "actionType": "42",
        "id": str(course_id),
        "menuId": MENU_ID,
        "_csrf": csrf or "",
    }, headers=headers, timeout=30)
    return r.text

def extract_units_from_tabs(html):
    soup = BeautifulSoup(html, "html.parser")
    result = []
    ul = soup.find(id="courselistunit") or soup
    # Find anchors that represent units
    for a in ul.find_all("a"):
        text = a.get_text(" ", strip=True)
        # try to find unit number in text like "Unit 1"
        m = re.search(r"Unit\s*(\d+)", text, re.IGNORECASE)
        num = int(m.group(1)) if m else None
        uid = None
        onclick = a.get("onclick")
        if onclick:
            m2 = re.search(r"handleclassUnit\s*\(\s*'?(\d+)'?\s*\)", onclick, re.IGNORECASE)
            if m2:
                uid = m2.group(1)
        if not uid:
            href = a.get("href", "")
            m3 = re.search(r"courseUnit_(\d+)", href)
            if m3:
                uid = m3.group(1)
        result.append({"number": num, "title": text, "unit_id": uid})
    return result

# ---------- Classes inside unit ----------

def fetch_live_unit_content(session, unit_id):
    headers = {"Referer": f"{BASE_URL}/Academy/s/studentProfilePESU", "X-Requested-With": "XMLHttpRequest"}
    r = session.get(SUBJECTS_URL, params={
        "controllerMode": "6403",
        "actionType": "43",
        "coursecontentid": str(unit_id),
        "menuId": MENU_ID,
        "subType": "3",
        "_": str(int(time.time() * 1000)),
    }, headers=headers, timeout=30)
    return r.text

def parse_live_unit_classes(html):
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    if not table:
        return [], []
    headers = [th.get_text(" ", strip=True) for th in (table.thead.find_all("th") if table.thead else table.find_all("th"))]
    items = []
    onclick_re = re.compile(
        r"handleclasscoursecontentunit\s*\(\s*'([^']+)'\s*,\s*'?(.*?)'?\s*,\s*'?(.*?)'?\s*,\s*'?(.*?)'?\s*,\s*'?(.*?)'?",
        re.IGNORECASE
    )
    rows = (table.tbody.find_all("tr") if table.tbody else table.find_all("tr"))
    for tr in rows:
        tds = tr.find_all("td")
        if not tds:
            continue
        title = tds[0].get_text(" ", strip=True)
        args = None
        # search onclick in several elements
        for el in [tr, tds[0]] + tds[0].find_all("a"):
            onclick = el.get("onclick") if hasattr(el, 'get') else None
            if onclick:
                m = onclick_re.search(onclick)
                if m:
                    args = m.groups()
                    break
        resource_counts = []
        for td in tds[1:]:
            a = td.find("a")
            txt = a.get_text(" ", strip=True) if a else td.get_text(" ", strip=True)
            cnt = re.search(r"(\d+)", txt)
            resource_counts.append(cnt.group(1) if cnt else (txt or "-"))
        items.append({
            "title": title,
            "resource_counts": resource_counts,
            "args": {
                "uuid": args[0] if args else None,
                "courseId": args[1] if args else None,
                "unitId": args[2] if args else None,
                "classNo": args[3] if args else None,
                "resourceType": args[4] if args else None,
            }
        })
    return headers, items

# ---------- Preview HTML & doc ids ----------

def fetch_preview_and_ids(session, entry):
    slides = entry.get("args") or {}
    courseunitid = slides.get("uuid")
    subjectid = slides.get("courseId")
    coursecontentid = slides.get("unitId")
    classNo = slides.get("classNo")
    rtype = slides.get("resourceType") or "2"
    if not (courseunitid and subjectid):
        return [], ""
    # refresh CSRF
    prof = session.get(f"{BASE_URL}/Academy/s/studentProfilePESU", headers=HEADERS_BASE)
    soup = BeautifulSoup(prof.text, "html.parser")
    csrf = None
    m = soup.find("meta", {"name": "csrf-token"})
    if m and m.has_attr("content"):
        csrf = m["content"]
    headers = {
        "Referer": f"{BASE_URL}/Academy/s/studentProfilePESU",
        "X-Requested-With": "XMLHttpRequest",
    }
    if csrf:
        headers["X-CSRF-Token"] = csrf
    # try actionType=60 first (preview)
    p60 = {
        "controllerMode": "6403",
        "actionType": "60",
        "selectedData": str(subjectid),
        "id": "2",
        "unitid": str(courseunitid),
        "menuId": MENU_ID,
        "_": str(int(time.time() * 1000)),
    }
    r60 = session.get(SUBJECTS_URL, params=p60, headers=headers, timeout=30)
    html = r60.text or ""
    ids = set(re.findall(r"downloadcoursedoc\s*\(\s*['\"]([a-f0-9\-]{6,})['\"]", html, flags=re.IGNORECASE))
    if ids:
        return list(ids), html
    # fallback to actionType=343 (older path)
    if not (coursecontentid and classNo):
        return [], html
    p343 = {
        "controllerMode": "9978",
        "actionType": "343",
        "courseunitid": str(courseunitid),
        "subjectid": str(subjectid),
        "coursecontentid": str(coursecontentid),
        "classNo": str(classNo),
        "type": str(rtype),
        "menuId": MENU_ID,
        "selectedData": "0",
        "_": str(int(time.time() * 1000)),
    }
    r343 = session.get(SUBJECTS_URL, params=p343, headers=headers, timeout=30)
    html = r343.text or html
    ids = set(re.findall(r"downloadcoursedoc\s*\(\s*['\"]([a-f0-9\-]{6,})['\"]", html, flags=re.IGNORECASE))
    if not ids:
        ids = set(re.findall(r"href=['\"][^'\"]*download(?:slide)?coursedoc/([a-f0-9\-]{6,})", html, flags=re.IGNORECASE))
    return list(ids), html

# ---------- Download ----------

def download_by_ids(session, doc_ids, si_no, title, out_dir):
    safe_mkdir(out_dir)
    saved = []
    headers = {
        "Referer": f"{BASE_URL}/Academy/s/studentProfilePESU",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": HEADERS_BASE["User-Agent"],
    }
    for i, did in enumerate(doc_ids, 1):
        url = f"{BASE_URL}/Academy/a/referenceMeterials/downloadslidecoursedoc/{did}"
        resp = session.get(url, headers=headers, allow_redirects=True, timeout=60)
        if resp.status_code != 200 or not resp.content:
            print("  [!] failed to fetch", url)
            continue
        ct = resp.headers.get("Content-Type", "")
        cd = resp.headers.get("Content-Disposition", "")
        filename = None
        if cd:
            m = re.search(r"filename\*=UTF-8''([^;]+)", cd)
            if m:
                filename = m.group(1)
            else:
                m = re.search(r'filename="?([^";]+)"?', cd)
                if m:
                    filename = m.group(1)
        if not filename:
            # guess ext from content-type
            ext = ".pdf"
            if "pdf" in ct.lower():
                ext = ".pdf"
            elif "word" in ct.lower() or "msword" in ct.lower():
                ext = ".docx"
            elif "powerpoint" in ct.lower() or "ppt" in ct.lower():
                ext = ".pptx"
            elif "zip" in ct.lower():
                ext = ".zip"
            suffix = f"_{i}" if len(doc_ids) > 1 else ""
            filename = f"{si_no:02d}{suffix}_{slugify(title)}{ext}"
        dest = os.path.join(out_dir, filename)
        try:
            with open(dest, "wb") as f:
                f.write(resp.content)
            print("Saved:", dest)
            saved.append(dest)
        except Exception as e:
            print("Could not save:", e)
    return saved

# ---------- CLI flow ----------

def parse_range(text, max_n):
    s = (text or "").strip()
    if not s or s == "-":
        return list(range(1, max_n + 1))
    if "-" in s:
        a, b = s.split("-", 1)
        a = a.strip()
        b = b.strip()
        start = 1 if a == "" else int(a)
        end = max_n if b == "" else int(b)
        if start > end:
            start, end = end, start
        start = max(1, min(max_n, start))
        end = max(1, min(max_n, end))
        return list(range(start, end + 1))
    try:
        n = int(s)
        if 1 <= n <= max_n:
            return [n]
    except Exception:
        pass
    return []

def print_table(headers, rows):
    if not rows:
        print("(empty)")
        return
    num_cols = max(len(headers), max((len(r) for r in rows), default=0))
    widths = [0]*num_cols
    for i in range(num_cols):
        if i < len(headers):
            widths[i] = max(widths[i], len(headers[i]))
        for r in rows:
            cell = r[i] if i < len(r) else ""
            widths[i] = max(widths[i], len(cell))
    def fmt(row):
        return " | ".join((row[i] if i < len(row) else "").ljust(widths[i]) for i in range(num_cols))
    if headers:
        print(fmt(headers))
        print("-+-".join("-"*w for w in widths))
    for r in rows:
        print(fmt(r))

def main():
    s = requests.Session()
    s.headers.update(HEADERS_BASE)
    print("=== PESU Academy Interactive Scraper ===")
    user = input("Username: ").strip()
    pwd = input("Password: ").strip()
    if not login(s, user, pwd):
        print("Login failed; exiting.")
        return

    semesters = get_semesters(s)
    if not semesters:
        print("No semesters found")
        return
    print("\nSemesters:")
    for i, (sid, name) in enumerate(semesters, 1):
        print(f"{i}. {name} ({sid})")
    try:
        choice = int(input("Select semester number: "))
        if choice < 1 or choice > len(semesters):
            print("Invalid choice"); return
    except Exception:
        print("Invalid input"); return
    sem_id = semesters[choice-1][0]

    subjects_html = get_subjects_html(s, sem_id)
    headers, items = parse_subjects_with_course_ids(subjects_html)
    if not items:
        print("No subjects parsed; raw HTML preview:")
        print((subjects_html or "")[:1000])
        return
    print("\nSubjects (table):")
    rows = [it["cells"] for it in items]
    print_table(headers, rows)
    try:
        ci = int(input("Select a course row number: "))
    except Exception:
        print("Invalid"); return
    if ci < 1 or ci > len(items):
        print("Invalid"); return
    course_id = items[ci-1].get("course_id")
    if not course_id:
        print("Selected row has no course_id; cannot proceed."); return

    course_html = get_course_content(s, course_id)
    units = extract_units_from_tabs(course_html)
    if not units:
        print("No units found; raw HTML preview:")
        print((course_html or "")[:1000])
        return
    print("\nUnits:")
    for i, u in enumerate(units, 1):
        print(f"{i}. {u['title']}")
    try:
        ui = int(input("Select unit number: "))
    except Exception:
        print("Invalid"); return
    if ui < 1 or ui > len(units):
        print("Invalid"); return
    unit_id = units[ui-1].get("unit_id")
    if not unit_id:
        print("Unit has no unit_id; cannot proceed."); return

    live_html = fetch_live_unit_content(s, unit_id)
    ch, class_items = parse_live_unit_classes(live_html)
    if not class_items:
        print("No classes found; raw HTML preview:")
        print((live_html or "")[:1000])
        return

    # show condensed table
    condensed_rows = []
    for idx, it in enumerate(class_items, 1):
        si_no = it.get("args", {}).get("classNo") or str(idx)
        name = it.get("title") or ""
        rc = it.get("resource_counts") or []
        slides_val = rc[2] if len(rc) > 2 else "-"
        condensed_rows.append([str(si_no), name, str(slides_val)])
    print("\nClasses:")
    print_table(["SI No.", "Name", "Slides"], condensed_rows)

    rng = input("\nEnter slides range (a-b, -b, a-, -, or single number): ").strip()
    indices = parse_range(rng, len(class_items))
    if not indices:
        print("No selection"); return

    out_dir = input("Download folder (enter to use ./downloads): ").strip() or "./downloads"
    out_dir = os.path.abspath(out_dir)
    safe_mkdir(out_dir)
    print("Downloading into:", out_dir)

    for idx in indices:
        if idx < 1 or idx > len(class_items):
            print("Skipping invalid index", idx); continue
        entry = class_items[idx-1]
        doc_ids, _html = fetch_preview_and_ids(s, entry)
        if not doc_ids:
            print("No documents found for class", idx, "-", entry.get("title"))
            continue
        saved = download_by_ids(s, doc_ids, idx, entry.get("title") or f"class_{idx}", out_dir)
        if not saved:
            print("No files saved for class", idx)
        time.sleep(0.4)

    print("\nDone.")

if __name__ == "__main__":
    main()
