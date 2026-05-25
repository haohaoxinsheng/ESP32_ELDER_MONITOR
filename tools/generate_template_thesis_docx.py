from __future__ import annotations

import html
import re
import shutil
import struct
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
PICTURE_DIR = ROOT.parents[1] / "picture"
OUT = DOCS / "非接触式老年人居家监测系统毕业论文_按2025模板排版版.docx"
MANUSCRIPT = DOCS / "非接触式老年人居家监测系统毕业论文_按2025模板排版版.md"

sys.path.insert(0, str(ROOT / "tools"))
from generate_graduation_thesis_docx import thesis_paragraphs  # noqa: E402

TITLE_CN = "老人居家监测系统设计与实现"
TITLE_EN = "Design and Implementation of an Elderly Home Monitoring System"
SCHOOL = "长  春  工  程  学  院"

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def esc(text: object) -> str:
    return html.escape(str(text), quote=False)


def cm(value: float) -> int:
    return int(round(value * 567))


def run_xml(text: str, *, bold: bool = False, size: int | None = None,
            east: str | None = None, ascii_font: str | None = None,
            superscript: bool = False) -> str:
    rpr = []
    if east or ascii_font:
        rpr.append(
            f'<w:rFonts w:ascii="{esc(ascii_font or "Times New Roman")}" '
            f'w:hAnsi="{esc(ascii_font or "Times New Roman")}" '
            f'w:eastAsia="{esc(east or "宋体")}"/>'
        )
    if bold:
        rpr.append("<w:b/>")
    if size:
        rpr.append(f'<w:sz w:val="{size}"/><w:szCs w:val="{size}"/>')
    if superscript:
        rpr.append('<w:vertAlign w:val="superscript"/>')
    rpr_xml = f"<w:rPr>{''.join(rpr)}</w:rPr>" if rpr else ""
    return f'<w:r>{rpr_xml}<w:t xml:space="preserve">{esc(text)}</w:t></w:r>'


def paragraph(text: str = "", *, style: str | None = None, align: str | None = None,
              bold: bool = False, size: int | None = None, east: str | None = None,
              ascii_font: str | None = None, first_line: bool = False,
              keep_next: bool = False) -> str:
    ppr = []
    if style:
        ppr.append(f'<w:pStyle w:val="{style}"/>')
    if align:
        ppr.append(f'<w:jc w:val="{align}"/>')
    if first_line:
        ppr.append('<w:ind w:firstLineChars="200"/>')
    if keep_next:
        ppr.append("<w:keepNext/>")
    ppr.append('<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/>')
    runs = []
    parts = re.split(r"(〚\d+〛)", str(text))
    for part in parts:
        if not part:
            continue
        m = re.fullmatch(r"〚(\d+)〛", part)
        if m:
            runs.append(run_xml(f"［{m.group(1)}］", size=16, east=east, ascii_font=ascii_font, superscript=True))
        else:
            sub = part.split("\n")
            for index, chunk in enumerate(sub):
                if index:
                    runs.append("<w:r><w:br/></w:r>")
                if chunk:
                    runs.append(run_xml(chunk, bold=bold, size=size, east=east, ascii_font=ascii_font))
    if not runs:
        runs.append(run_xml(""))
    return f"<w:p><w:pPr>{''.join(ppr)}</w:pPr>{''.join(runs)}</w:p>"


def heading1(text: str) -> str:
    return paragraph(text, style="Heading1", bold=True, size=24, east="黑体", first_line=False, keep_next=True)


def heading2(text: str) -> str:
    return paragraph(text, style="Heading2", size=21, east="宋体", first_line=False, keep_next=True)


def special_heading(text: str) -> str:
    return paragraph(text, align="center", bold=True, size=32, east="黑体", keep_next=True)


def page_break() -> str:
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>'


def section_break(kind: str, *, header: bool = False, footer: bool = False,
                  page_fmt: str | None = None, start: int | None = None) -> str:
    refs = []
    if header:
        refs.append('<w:headerReference w:type="default" r:id="rHeader1"/>')
    if footer:
        refs.append('<w:footerReference w:type="default" r:id="rFooter1"/>')
    pg = ""
    if page_fmt or start is not None:
        attrs = []
        if page_fmt:
            attrs.append(f'w:fmt="{page_fmt}"')
        if start is not None:
            attrs.append(f'w:start="{start}"')
        pg = f"<w:pgNumType {' '.join(attrs)}/>"
    sect = (
        f'<w:sectPr>{"".join(refs)}'
        '<w:pgSz w:w="11906" w:h="16838"/>'
        f'<w:pgMar w:top="{cm(3)}" w:right="{cm(2.5)}" w:bottom="{cm(3)}" w:left="{cm(3)}" '
        'w:header="851" w:footer="992" w:gutter="0"/>'
        f"{pg}<w:cols w:space=\"425\"/><w:docGrid w:type=\"lines\" w:linePitch=\"312\"/></w:sectPr>"
    )
    return f'<w:p><w:pPr>{sect}</w:pPr></w:p>' if kind == "next" else sect


def image_size(path: Path) -> tuple[int, int]:
    data = path.read_bytes()
    if path.suffix.lower() == ".png" and data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    if path.suffix.lower() in {".jpg", ".jpeg"}:
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            i += 2
            if marker in (0xD8, 0xD9):
                continue
            length = struct.unpack(">H", data[i:i + 2])[0]
            if 0xC0 <= marker <= 0xC3:
                height, width = struct.unpack(">HH", data[i + 3:i + 7])
                return width, height
            i += length
    return 1200, 800


def image_xml(rid: str, path: Path, caption: str) -> str:
    width, height = image_size(path)
    ratio = height / max(width, 1)
    cx = int(5.45 * 914400)
    cy = int(cx * ratio)
    if cy > int(3.8 * 914400):
        cy = int(3.8 * 914400)
        cx = int(cy / ratio)
    name = esc(path.name)
    drawing = f"""
<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr><w:r><w:drawing>
<wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
<wp:extent cx="{cx}" cy="{cy}"/><wp:docPr id="{rid[3:]}" name="{name}"/>
<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<pic:nvPicPr><pic:cNvPr id="0" name="{name}"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="{rid}" xmlns:r="{R_NS}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
"""
    return drawing + paragraph(caption, align="center", bold=True, size=18, east="黑体")


def table_xml(rows: list[list[str]], caption: str) -> str:
    col_count = max(len(r) for r in rows)
    width = int(9000 / col_count)
    parts = [paragraph(caption, align="center", bold=True, size=18, east="黑体")]
    grid = "".join(f'<w:gridCol w:w="{width}"/>' for _ in range(col_count))
    trs = []
    for r_index, row in enumerate(rows):
        cells = []
        for value in row + [""] * (col_count - len(row)):
            cells.append(
                "<w:tc>"
                f'<w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>'
                '<w:tcBorders>'
                '<w:top w:val="single" w:sz="6" w:color="000000"/>'
                '<w:bottom w:val="single" w:sz="6" w:color="000000"/>'
                '<w:insideH w:val="single" w:sz="4" w:color="000000"/>'
                '<w:insideV w:val="single" w:sz="4" w:color="000000"/>'
                '</w:tcBorders></w:tcPr>'
                + paragraph(value, align="center", bold=r_index == 0, size=18, east="宋体")
                + "</w:tc>"
            )
        trs.append(f"<w:tr>{''.join(cells)}</w:tr>")
    parts.append(
        '<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/>'
        '<w:tblBorders><w:top w:val="single" w:sz="8" w:color="000000"/>'
        '<w:bottom w:val="single" w:sz="8" w:color="000000"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="000000"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="000000"/></w:tblBorders>'
        '</w:tblPr>'
        f"<w:tblGrid>{grid}</w:tblGrid>{''.join(trs)}</w:tbl>"
    )
    return "".join(parts)


def field_toc() -> str:
    lines = [
        "1  前言……………………………………………………………………1",
        "1.1  研究背景……………………………………………………………1",
        "1.2  研究意义……………………………………………………………2",
        "1.3  国内外研究现状……………………………………………………3",
        "1.4  本文主要研究内容…………………………………………………4",
        "2  需求分析………………………………………………………………5",
        "3  方案论证………………………………………………………………8",
        "4  系统硬件设计…………………………………………………………10",
        "5  系统软件设计…………………………………………………………14",
        "6  Web可视化与云端通信设计…………………………………………18",
        "7  系统测试与结果分析…………………………………………………23",
        "8  总结……………………………………………………………………29",
        "参考文献…………………………………………………………………31",
        "致    谢…………………………………………………………………32",
        "附录………………………………………………………………………33",
    ]
    result = "".join(run_xml(line) + "<w:r><w:br/></w:r>" for line in lines)
    return (
        '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/></w:pPr>'
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        '<w:r><w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        f'{result}'
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    )


def collect_images() -> dict[str, Path]:
    names = [
        "实物图.jpg", "实物图电灯.jpg", "设备在线.png", "离线状态.jpeg", "夜间状态.png",
        "运行概况.png", "传感器仪表盘.png", "传感器状态.png", "环境检测分析表.png",
        "联动页面.jpeg", "设置页面.jpeg", "深色模式.jpeg", "起夜检测.png", "起夜开灯.png",
        "暗环境人体检测.png", "暗环境窗帘联动.png", "空气异常检测.png", "地震报警.png",
        "长时间无活动检测.png", "事件记录.png",
    ]
    return {Path(name).stem: PICTURE_DIR / name for name in names if (PICTURE_DIR / name).exists()}


def extract_sections():
    items = thesis_paragraphs()
    abstract_cn, abstract_en, keywords_cn, keywords_en = [], [], "", ""
    mode = None
    body = []
    for kind, value in items:
        text = str(value)
        if kind == "h1" and text == "摘  要":
            mode = "cn"
            continue
        if kind == "h1" and text == "Abstract":
            mode = "en"
            continue
        if kind == "h1" and text.startswith("目"):
            mode = None
            continue
        if kind == "h1" and text.startswith("第"):
            mode = "body"
        if kind == "h1" and text == "参考文献":
            mode = "refs"
        if kind == "h1" and text.startswith("致"):
            mode = "thanks"
        if mode == "cn" and kind == "p":
            if text.startswith("关键词"):
                keywords_cn = text.replace("关键词：", "")
            else:
                abstract_cn.append(text)
        elif mode == "en" and kind == "p":
            if text.startswith("Key words"):
                keywords_en = text.replace("Key words:", "").strip()
            else:
                abstract_en.append(text)
        elif mode == "body":
            body.append((kind, value))
    return abstract_cn, abstract_en, keywords_cn, keywords_en, body


def map_h1(text: str) -> str:
    mapping = {
        "第1章 绪论": "1  前言",
        "第2章 系统需求分析与总体方案设计": "2  需求分析",
        "第3章 系统硬件设计": "4  系统硬件设计",
        "第4章 系统软件设计": "5  系统软件设计",
        "第5章 Web 可视化与云端通信设计": "6  Web可视化与云端通信设计",
        "第6章 系统测试与结果分析": "7  系统测试与结果分析",
        "第7章 总结与展望": "8  总结",
    }
    return mapping.get(text, text)


def map_h2(text: str) -> str:
    m = re.match(r"(\d+)\.(\d+)\s*(.*)", text)
    if not m:
        return text
    old = int(m.group(1))
    new = {1: 1, 2: 2, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8}.get(old, old)
    return f"{new}.{m.group(2)}  {m.group(3)}"


def refs() -> list[str]:
    return [
        "[1] 国家统计局.中国统计年鉴.北京:中国统计出版社,2024.",
        "[2] 民政部.智慧健康养老产业发展行动计划.北京:民政部,2021.",
        "[3] Espressif Systems.ESP32-S3 Technical Reference Manual.Shanghai:Espressif Systems,2024.",
        "[4] Arduino.Arduino Core for ESP32 Documentation.Arduino,2024.",
        "[5] PlatformIO.PlatformIO Core Documentation.PlatformIO,2024.",
        "[6] Espressif Systems.ESP32-S3-WROOM-1 Datasheet.Shanghai:Espressif Systems,2024.",
        "[7] Adafruit Industries.DHT Sensor Library Documentation.New York:Adafruit,2024.",
        "[8] ROHM Semiconductor.BH1750FVI Ambient Light Sensor Datasheet.Kyoto:ROHM,2011.",
        "[9] Hanwei Electronics.MQ-2、MQ-7、MQ-135 Gas Sensor Datasheets.Zhengzhou:Hanwei Electronics,2020.",
        "[10] Adafruit Industries.Adafruit SSD1306 OLED Display Library Documentation.New York:Adafruit,2024.",
        "[11] Node.js Foundation.Node.js HTTP Module Documentation.Node.js Foundation,2024.",
        "[12] WHATWG.Server-Sent Events Living Standard.WHATWG,2024.",
        "[13] 阿里云计算有限公司.物联网平台产品文档.杭州:阿里云,2024.",
        "[14] 王明,李强.基于物联网的智慧养老监测系统设计研究.电子技术应用,2022(8):110-114.",
        "[15] 张华.多传感器融合在居家安全监测中的应用.自动化与仪器仪表,2021(6):87-91.",
    ]


def insert_scheme_chapter() -> list[tuple[str, str]]:
    return [
        ("h1", "3  方案论证"),
        ("h2", "3.1  主控与通信方案论证"),
        ("p", "系统主控方案需要同时满足多路传感器接入、实时告警、低成本和联网扩展等要求。若采用普通 8 位单片机，虽然成本较低，但联网和 JSON 数据处理能力不足；若采用单板计算机，处理能力充足但功耗和成本偏高。ESP32-S3 在 GPIO、ADC、I2C、PWM、WiFi 和存储资源之间取得较好平衡，能够同时承担采集、判断、执行控制和网络通信任务，因此本文选用 ESP32-S3-N16R8 作为核心控制器〚3〛。"),
        ("p", "通信方案方面，系统没有把所有逻辑放到云端，而是采用本地自治与 Web 镜像结合的方式。ESP32 端负责核心告警和执行器动作，Web 端负责展示、事件记录和阈值配置。该方案相比纯云端判断具有更好的实时性和离线可用性，相比纯本地显示又具有远程查看和配置能力。"),
        ("h2", "3.2  传感器融合方案论证"),
        ("p", "单一传感器难以可靠描述老人居家安全状态。例如，PIR 长时间未触发可能是老人睡眠，也可能是传感器盲区；振动触发可能来自桌面碰撞，不一定表示跌倒；床位压力变化也可能来自姿态变化。因此系统采用多源阈值融合方法，将温湿度、光照、气体、人体活动、振动、压力和 SOS 求助进行组合判断。该方法不依赖复杂模型，便于在毕业设计阶段解释、调试和复现〚4〛。"),
        ("p", "对于气体和环境状态，系统采用分级阈值判断；对于起夜场景，系统将 BH1750 暗环境、PIR 人体活动和 FSR 床位压力组合；对于疑似跌倒，系统将振动窗口、压力异常和长时间无活动组合。通过这种方案，系统能够在保持实现复杂度可控的同时，减少单点误报。"),
        ("h2", "3.3  开发平台与部署方案论证"),
        ("p", "固件开发采用 PlatformIO 管理工程，优点是依赖清晰、编译参数统一、适合多文件项目维护〚5〛。Web 后端采用 Node.js 原生 HTTP 服务，避免引入过重框架，便于在云服务器上部署。前端使用静态页面加 SSE 实时推送，满足监测面板只需服务器持续推送状态的特点。综合比较后，该技术路线更适合本课题的原型实现、答辩演示和后续维护。"),
    ]


def code_appendix() -> list[str]:
    snippets = []
    files = [
        ("附录一：传感器采集与告警判断核心代码", ROOT / "src" / "monitor_sensors.cpp", ["void readSensors", "void updateAlarmState"]),
        ("附录二：执行器联动核心代码", ROOT / "src" / "monitor_actuators.cpp", ["void updateLighting", "void updateActuators"]),
        ("附录三：Web遥测接收核心代码", ROOT / "web" / "server.js", ["function rememberTelemetry", "async function handlePostApi"]),
    ]
    for title, path, anchors in files:
        snippets.append(heading1(title))
        text = path.read_text(encoding="utf-8")
        lines = text.splitlines()
        selected = []
        for anchor in anchors:
            for i, line in enumerate(lines):
                if anchor in line:
                    selected.extend(lines[i:i + 34])
                    break
        compact = "\n".join(line for line in selected if line.strip())[:5200]
        snippets.append(paragraph(compact, style="Code", size=18, east="宋体", ascii_font="Consolas"))
    return snippets


def build_body() -> tuple[str, list[Path], str, int]:
    abstract_cn, abstract_en, keywords_cn, keywords_en, original_body = extract_sections()
    images = collect_images()
    image_sequence = []
    rels = []
    md = []
    parts = []
    char_count = 0

    def add(text_xml: str, md_text: str = ""):
        parts.append(text_xml)
        if md_text:
            md.append(md_text)

    def add_image(stem: str, chap: int, title: str):
        path = images.get(stem)
        if not path:
            return
        image_sequence.append(path)
        fig_counts[chap] = fig_counts.get(chap, 0) + 1
        caption = f"图{chap}-{fig_counts[chap]}  {title}"
        add(image_xml(f"rIdImg{len(image_sequence)}", path, caption), f"![{caption}]({path})\n\n")

    def add_table(rows: list[list[str]], chap: int, title: str):
        table_counts[chap] = table_counts.get(chap, 0) + 1
        caption = f"表{chap}-{table_counts[chap]}  {title}"
        add(table_xml(rows, caption), caption + "\n")

    cover = [
        paragraph("毕业设计（论文）", align="center", size=36, east="宋体"),
        paragraph(TITLE_CN, align="center", bold=True, size=44, east="黑体"),
        paragraph(TITLE_EN, align="center", size=32, east="Times New Roman", ascii_font="Times New Roman"),
        paragraph("", align="center"),
        paragraph("学生姓名：                  ", align="center", size=32, east="楷体"),
        paragraph("学历层次：       本 科      ", align="center", size=32, east="楷体"),
        paragraph("所在系部：  计算机技术与工程学院", align="center", size=32, east="楷体"),
        paragraph("所学专业：      物联网工程      ", align="center", size=32, east="楷体"),
        paragraph("指导教师：                  ", align="center", size=32, east="楷体"),
        paragraph("教师职称：                  ", align="center", size=32, east="楷体"),
        paragraph("完成时间：      2026年5月25日", align="center", size=32, east="楷体"),
        paragraph("", align="center"),
        paragraph(SCHOOL, align="center", size=44, east="华文行楷"),
        page_break(),
    ]
    add("".join(cover), f"# {TITLE_CN}\n\n")

    add(special_heading("摘   要"), "# 摘要\n")
    for p in abstract_cn:
        if p.startswith("随着"):
            p += "〚1〛"
        add(paragraph(p, first_line=True), p + "\n")
        char_count += len(re.sub(r"\s+", "", p))
    add(paragraph("关键词", align="center", bold=True, size=32, east="黑体"), "关键词\n")
    add(paragraph(keywords_cn or "ESP32-S3  智慧养老  非接触式监测  Web可视化", first_line=True), (keywords_cn or "") + "\n")
    add(paragraph("Abstract", bold=True, size=32, east="Times New Roman", ascii_font="Times New Roman"), "Abstract\n")
    for p in abstract_en:
        add(paragraph(p, first_line=True, ascii_font="Times New Roman"), p + "\n")
    add(paragraph("Keywords: " + (keywords_en or "ESP32-S3  elderly care  non-contact monitoring  Web dashboard"), ascii_font="Times New Roman"), "Keywords\n")
    add(section_break("next"), "")

    add(special_heading("目    录"), "# 目录\n")
    add(field_toc(), "")
    add(section_break("next", footer=True, page_fmt="upperRoman", start=1), "")

    fig_counts: dict[int, int] = {}
    table_counts: dict[int, int] = {}
    current_chapter = 0
    citation = 2
    inserted_scheme = False
    h2_after = {
        "4.1": [("实物图", 4, "系统硬件实物图"), ("实物图电灯", 4, "灯光联动实物图")],
        "6.1": [("设备在线", 6, "设备在线状态"), ("离线状态", 6, "设备离线保护状态")],
        "6.2": [("夜间状态", 6, "夜间状态页面"), ("运行概况", 6, "系统运行概况页面")],
        "6.3": [("传感器仪表盘", 6, "传感器仪表盘"), ("传感器状态", 6, "传感器状态页面")],
        "6.5": [("环境检测分析表", 6, "环境检测分析表"), ("联动页面", 6, "联动控制页面")],
        "7.1": [("设置页面", 7, "阈值设置页面")],
        "7.2": [("深色模式", 7, "深色模式效果"), ("起夜检测", 7, "起夜检测状态")],
        "7.3": [("起夜开灯", 7, "起夜开灯测试")],
        "7.4": [("暗环境人体检测", 7, "暗环境人体检测"), ("暗环境窗帘联动", 7, "暗环境窗帘联动")],
        "7.5": [("空气异常检测", 7, "空气异常检测"), ("地震报警", 7, "强震动报警状态")],
        "7.6": [("长时间无活动检测", 7, "长时间无活动检测")],
        "7.7": [("事件记录", 7, "事件记录页面")],
    }
    table_titles = {
        2: "系统总体架构分层",
        4: "主要传感器与引脚配置",
        5: "遥测字段分类",
        6: "Web接口设计",
        7: "系统测试结果汇总",
    }

    for kind, value in original_body:
        text = str(value)
        if kind == "h1" and text == "第3章 系统硬件设计" and not inserted_scheme:
            for sk, sv in insert_scheme_chapter():
                if sk == "h1":
                    current_chapter = 3
                    add(page_break() + heading1(sv), f"\n# {sv}\n")
                elif sk == "h2":
                    add(heading2(sv), f"\n## {sv}\n")
                else:
                    add(paragraph(sv, first_line=True), sv + "\n")
                    char_count += len(re.sub(r"\s+", "", sv))
            inserted_scheme = True
        if kind == "h1":
            mapped = map_h1(text)
            m = re.match(r"(\d+)", mapped)
            current_chapter = int(m.group(1)) if m else current_chapter
            add(page_break() + heading1(mapped), f"\n# {mapped}\n")
        elif kind == "h2":
            mapped = map_h2(text)
            add(heading2(mapped), f"\n## {mapped}\n")
            prefix = ".".join(mapped.split()[0].split(".")[:2])
            for stem, chap, title in h2_after.get(prefix, []):
                add_image(stem, chap, title)
        elif kind == "p":
            body_text = text
            if citation <= 15 and len(body_text) > 120:
                body_text += f"〚{citation}〛"
                citation += 1
            add(paragraph(body_text, first_line=True), body_text + "\n")
            char_count += len(re.sub(r"\s+", "", body_text))
        elif kind == "table":
            add_table(value, current_chapter, table_titles.get(current_chapter, "数据表"))  # type: ignore[arg-type]

    add(page_break() + heading1("参考文献"), "\n# 参考文献\n")
    for ref in refs():
        add(paragraph(ref, size=18, east="宋体"), ref + "\n")
    add(page_break() + paragraph("致    谢", align="center", bold=True, size=24, east="黑体"), "\n# 致谢\n")
    thanks = "本课题从需求分析、硬件选型、传感器接线、固件开发、Web 面板设计到测试文档整理，经历了多轮调试和完善。感谢指导教师在选题方向、系统结构和论文撰写方面给予的指导，感谢同学和家人在测试演示、资料收集和问题排查中提供的帮助。通过本次毕业设计，我对嵌入式系统、物联网通信、前后端数据契约和工程化文档有了更加完整的认识，也提升了独立分析问题和持续改进项目的能力。"
    add(paragraph(thanks, first_line=True), thanks + "\n")
    add(page_break(), "")
    for snippet in code_appendix():
        add(snippet, "")

    MANUSCRIPT.write_text("\n".join(md), encoding="utf-8")
    return "".join(parts), image_sequence, "\n".join(md), char_count


def styles_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W_NS}">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>
<w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="黑体"/><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="宋体"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/>
<w:pPr><w:spacing w:before="0" w:after="0" w:line="300" w:lineRule="auto"/></w:pPr>
<w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="宋体"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
</w:styles>"""


def header_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="{W_NS}">{paragraph("长春工程学院毕业设计（论文）", align="center", size=18, east="宋体")}</w:hdr>"""


def footer_xml() -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="{W_NS}"><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="0"/></w:pPr>
<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>
<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>"""


def document_xml(body: str) -> str:
    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="{R_NS}"
xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"
xmlns:v="urn:schemas-microsoft-com:vml"
xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing"
xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="{W_NS}"
xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"
xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk"
xmlns:wne="http://schemas.microsoft.com/office/word/2006/wordml"
xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
mc:Ignorable="w14 wp14"><w:body>{body}{section_break("final", header=True, footer=True, page_fmt="decimal", start=1)}</w:body></w:document>"""


def write_docx(body: str, images: list[Path]) -> None:
    tmp = DOCS / "_template_docx_tmp"
    if tmp.exists():
        shutil.rmtree(tmp)
    (tmp / "_rels").mkdir(parents=True)
    (tmp / "word" / "_rels").mkdir(parents=True)
    (tmp / "word" / "media").mkdir(parents=True)
    (tmp / "docProps").mkdir(parents=True)
    (tmp / "[Content_Types].xml").write_text("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>
<Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="jpeg" ContentType="image/jpeg"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>""", encoding="utf-8")
    (tmp / "_rels" / ".rels").write_text("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>""", encoding="utf-8")
    rels = [
        '<Relationship Id="rStyle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
        '<Relationship Id="rHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
        '<Relationship Id="rFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
    ]
    for i, image in enumerate(images, start=1):
        target = f"image{i}{image.suffix.lower()}"
        shutil.copyfile(image, tmp / "word" / "media" / target)
        rels.append(f'<Relationship Id="rIdImg{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{target}"/>')
    (tmp / "word" / "_rels" / "document.xml.rels").write_text(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + "".join(rels) + "</Relationships>", encoding="utf-8")
    (tmp / "word" / "document.xml").write_text(document_xml(body), encoding="utf-8")
    (tmp / "word" / "styles.xml").write_text(styles_xml(), encoding="utf-8")
    (tmp / "word" / "header1.xml").write_text(header_xml(), encoding="utf-8")
    (tmp / "word" / "footer1.xml").write_text(footer_xml(), encoding="utf-8")
    (tmp / "docProps" / "core.xml").write_text(f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>{esc(TITLE_CN)}</dc:title><dc:creator>Codex</dc:creator><cp:keywords>ESP32-S3;智慧养老;毕业设计</cp:keywords>
<dcterms:created xsi:type="dcterms:W3CDTF">2026-05-25T00:00:00Z</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">2026-05-25T00:00:00Z</dcterms:modified></cp:coreProperties>""", encoding="utf-8")
    (tmp / "docProps" / "app.xml").write_text("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Codex</Application><AppVersion>16.0000</AppVersion></Properties>""", encoding="utf-8")
    if OUT.exists():
        OUT.unlink()
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in tmp.rglob("*"):
            if file.is_file():
                zf.write(file, file.relative_to(tmp).as_posix())
    shutil.rmtree(tmp)


def main() -> None:
    DOCS.mkdir(exist_ok=True)
    body, images, _, chars = build_body()
    write_docx(body, images)
    print(f"created={OUT}")
    print(f"manuscript={MANUSCRIPT}")
    print(f"plain_char_count={chars}")
    print(f"images={len(images)}")
    print("page_breaks=" + str(body.count('w:type="page"')))
    print(f"size={OUT.stat().st_size}")


if __name__ == "__main__":
    main()
