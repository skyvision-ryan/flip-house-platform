from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.pdfgen import canvas
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.graphics import renderPDF

ROOT = Path('/Users/Ryan/Documents/GitHub/flip-house-platform')
OUT = ROOT / 'output/pdf/阶段目标与Jira经理指南_2026-09-15.pdf'
OUT.parent.mkdir(parents=True, exist_ok=True)
pdfmetrics.registerFont(TTFont('CN', '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
pdfmetrics.registerFont(TTFont('CNBold', '/System/Library/Fonts/STHeiti Medium.ttc', subfontIndex=0))
pdfmetrics.registerFontFamily('CN', normal='CN', bold='CNBold')

W, H = 612, 792
M = 42
CW = W - 2*M
INK = colors.HexColor('#17262c')
MUTED = colors.HexColor('#46565c')
LINE = colors.HexColor('#bdc7ca')
PALE = colors.HexColor('#f2f5f5')
ACCENT = colors.HexColor('#274f5b')
c = canvas.Canvas(str(OUT), pagesize=(W,H), pageCompression=1)
c.setTitle('翻房平台：阶段目标与 Jira 经理指南')
c.setAuthor('Flip House Platform')
c.setSubject('2026-09-15 管理者阅读版：阶段目标、交付验收、Jira 进度判断')

def box(x, top, w, h, fill=PALE, stroke=None, radius=6):
    c.setFillColor(fill or colors.white)
    c.setStrokeColor(stroke or fill or colors.white)
    c.setLineWidth(.65)
    c.roundRect(x,H-top-h,w,h,radius,fill=1,stroke=bool(stroke))

def rule(top, x=M, w=CW):
    c.setStrokeColor(LINE);c.setLineWidth(.6)
    c.line(x,H-top,x+w,H-top)

def text(x, top, s, size=11.2, font='CN', color=INK):
    c.setFont(font,size);c.setFillColor(color)
    c.drawString(x,H-top-size,s)

def para(s, x, top, w, size=11.2, leading=17.4, color=INK, bold=False, maxh=None):
    style=ParagraphStyle('p',fontName='CNBold' if bold else 'CN',fontSize=size,
                         leading=leading,textColor=color,wordWrap='CJK',splitLongWords=True,
                         spaceBefore=0,spaceAfter=0)
    p=Paragraph(s,style)
    _,h=p.wrap(w,1000)
    if maxh is not None and h>maxh+.1:
        raise ValueError(f'Overflow ({h}>{maxh}): {s[:50]}')
    p.drawOn(c,x,H-top-h)
    return h

def label(s,x,top):
    text(x,top,s,10.1,'CNBold',ACCENT)

def header(page,section,title,sub):
    text(M,30,'FLIP HOUSE PLATFORM  /  管理者阅读版',9,'CN',MUTED)
    c.setFont('CN',9);c.setFillColor(MUTED)
    c.drawRightString(W-M,H-39,'2026.09.15')
    label(section,M,55)
    text(M,75,title,22,'CNBold')
    para(sub,M,109,CW,11,17,color=MUTED,maxh=34)
    rule(748)
    text(M,757,'内部管理参考 · 目标日期不等于完成承诺 · 日期按洛杉矶时间',8.2,'CN',MUTED)
    c.setFont('CN',8.5);c.drawRightString(W-M,H-766,f'{page} / 4')

def endpage():
    c.showPage()

def link(k,label=None):
    return f'<link href="https://skyvisioninsurance.atlassian.net/browse/KAN-{k}" color="#274f5b"><u>{escape(label or "KAN-"+str(k))}</u></link>'

# PAGE 1: phase goals, plain language, no invented future dates.
header(1,'01 / 未来阶段总览','我们要把产品做成什么',
       '先让团队围绕每套房完成协作，再把真实经验变成可复用的软件与 AI。')
box(M,142,CW,51)
para('<b>当前位置：</b>已有演示原型；本轮已安排 3 个交付目标、15 张子任务。<br/>'
     '账号、任务协作、iPhone 和 AWS 新目标仍需开发与验收。',M+13,152,CW-26,10.8,16,maxh=34)

phases=[
('1','跑通一次完整交接','09-18 周五',
 '电脑分派任务，iPhone 看说明、交材料，负责人确认。',
 '两个人、两台设备走完流程，双方看到相同结果。'),
('2','在公司内部真正用起来','09-21 至 09-25',
 '把系统放到 AWS，先支持 2-3 套在建房。',
 '账号权限正确；更新系统不丢资料；数据可恢复。'),
('3','让流程稳定、数据可信','内部试用后',
 '根据现场反馈完善任务说明、等待原因、验收和成本记录。',
 '同事能直接更新工作，负责人少追问，资料能追溯。'),
('4','让 AI 成为公司的工作助手','数据与权限可靠后',
 '先查进度、找说明、写带来源的汇报；再辅助填写和办理。',
 '答案能核对；修改业务数据前由人确认，操作有记录。'),
('5','把验证过的产品提供给其他公司','外部试点验证后',
 '复用翻房模板，让其他团队也能快速上手，形成订阅服务。',
 '不同公司的数据分开；外部团队愿意持续使用并付费。'),
('6','扩展为更广泛的房产 AI 助手','翻房场景成熟后',
 '结合历史项目、成本和获授权资料，支持更多房产业务。',
 '建议有依据，结果可复盘；每扩一个场景都重新验证。'),
]
for i,(num,title,when,goal,check) in enumerate(phases):
    y=209+i*80
    box(M,y+1,28,28,fill=colors.white,stroke=ACCENT,radius=14)
    text(M+9,y+5,num,13,'CNBold',ACCENT)
    text(M+41,y,title,13,'CNBold')
    c.setFont('CN',9.6);c.setFillColor(MUTED);c.drawRightString(W-M,H-y-12,when)
    para(goal,M+41,y+23,CW-41,10.6,16,maxh=16)
    para('<b>看结果：</b>'+check,M+41,y+42,CW-41,10.5,16,maxh=16)
    if i<5:rule(y+70,M+41,CW-41)
para('后四个阶段按前一阶段的真实结果排期，目前没有承诺上线日期。',M,709,CW,10.1,15,color=MUTED)
endpage()

# PAGE 2: manager-facing, dated milestones and observable evidence.
header(2,'02 / 近期交付目标','本周与下周，分别验收什么',
       '经理先看“能做成什么”，再看剩下哪张票；不用阅读代码或记住云服务名称。')

milestones=[
('09-16','账号与权限就绪',17,
 '两位同事各自登录，任务能分派到具体人员。',
 '换账号不会看到无权查看的项目；停用后不能继续使用。',
 f'本阶段看 {link(20)}、{link(21)}；只占 KAN-17 的账号部分。'),
('09-17','房屋任务能安排、能追踪',18,
 '每套房有自己的任务、负责人、说明、日期和交付要求。',
 '等待有原因；材料不足不能直接完成；待办和总览一致。',
 f'本阶段看 {link(27)} 至 {link(30)}，共 4 张子票。'),
('09-18','iPhone 完成整条交接',19,
 '分派 → 看说明 → 等待/恢复 → 上传 → 提交 → 确认或退回。',
 '用真实 iPhone 演示，刷新后结果还在；网络失败不会误报成功。',
 f'本阶段看 {link(31)} 至 {link(34)}；首版用 Safari 和主屏幕入口。'),
('09-23','AWS 上线；09-24 至 09-25 内部试用',17,
 '应用、业务数据、附件和账号统一使用 AWS，先上 2-3 套房。',
 '重新部署不丢资料；备份能恢复；故障时能退回可用版本。',
 f'本阶段看 {link(22)} 至 {link(26)}；以实际云端验证为准。'),
]
for i,(date,title,k,result,check,detail) in enumerate(milestones):
    y=149+i*130
    box(M,y,CW,118,fill=colors.white,stroke=LINE)
    box(M+11,y+12,58,29,fill=PALE)
    text(M+17,y+17,date,11.5,'CNBold',ACCENT)
    text(M+81,y+12,title,12.7,'CNBold')
    para(link(k),W-M-62,y+34,52,9.8,14)
    para('<b>交付：</b>'+result,M+81,y+38,CW-98,10.7,16,maxh=32)
    para('<b>验收：</b>'+check,M+13,y+70,CW-26,10.6,16,maxh=16)
    para(detail,M+13,y+93,CW-26,9.9,15,color=MUTED,maxh=15)
box(M,683,CW,47)
para('<b>判断要点：</b>KAN-17 跨两周。账号部分通过，就能推进本周 demo；<br/>'
     '整张云部署票尚未关闭，不代表手机 demo 也被阻塞。',M+12,691,CW-24,10.5,16,maxh=32)
endpage()

# PAGE 3: actual Jira navigation and what managers should inspect.
header(3,'03 / Jira 读票指南','打开一张票，只看这六件事',
       '当前 Jira 记录“软件建设进度”；它和以后应用里每套房的施工任务，是两层管理。')
box(M,145,CW,61)
para('<b>父票 = 一个交付目标。</b>例如 KAN-19：iPhone 协作 demo。<br/>'
     '<b>子票 = 一块可独立验收的改动。</b>例如 KAN-31：我的待办与任务详情。<br/>'
     '父票看全局；发现问题，再打开对应子票。',M+12,154,CW-24,10.7,16,maxh=48)

label('先找到票',M,220)
para('进入 HouseFlipping → 待办事项列表 → Backlog，打开 KAN-17 / 18 / 19。<br/>'
     '找不到时，用顶部搜索输入票号，例如 KAN-19。',M,239,CW,10.6,17,maxh=34)

rows=[('交付目标','完成后，团队具体多了什么能使用的能力？'),
      ('负责人','谁对这张票负责？出现问题先找谁说明。'),
      ('目标日期','预期何时交付？有风险时，应说明原因和新日期。'),
      ('状态','目前处于哪一步；状态本身不证明功能已通过验收。'),
      ('前置 / 卡点','还在等哪项工作、哪份资料或谁的决定？'),
      ('验收 / 活动','如何证明完成？看演示、检查结果和最近更新。')]
for i,(name,meaning) in enumerate(rows):
    y=288+i*39
    if i%2==0:box(M,y,CW,39,fill=PALE,radius=0)
    text(M+11,y+10,name,10.8,'CNBold')
    para(meaning,M+115,y+10,CW-127,10.5,16,maxh=16)

label('状态怎样理解',M,538)
states=[('待办','尚未开始'),('进行中','正在处理'),('审查中','等待检查或验收'),('已完成','本票已关闭，核对证据')]
for i,(name,meaning) in enumerate(states):
    x=M+i*134
    box(x,558,126,55,fill=colors.white,stroke=LINE)
    text(x+9,567,name,11.3,'CNBold')
    para(meaning,x+9,585,108,9.3,14,maxh=28)
para('状态名称以实际票面为准。阻塞可能写在描述或评论里，并不一定有单独一列。',M,623,CW,9.8,15,color=MUTED,maxh=15)

para('<b>当前票面要留意</b><br/>子票先看描述顶部的“目标日期”和“前置”。<br/>页面上的截止日期、优先级可能尚未设置。<br/>不要只按颜色或默认优先级判断先后。',
     M,651,CW-101,10.1,16,maxh=64)
qr_url='https://skyvisioninsurance.atlassian.net/jira/software/projects/KAN/boards/2/backlog'
q=QrCodeWidget(qr_url,barLevel='M')
b=q.getBounds();qw=b[2]-b[0];qh=b[3]-b[1]
d=Drawing(70,70,transform=[70/qw,0,0,70/qh,0,0]);d.add(q)
renderPDF.draw(d,c,W-M-76,H-645-70)
c.linkURL(qr_url,(W-M-76,H-715,W-M-6,H-645),relative=0)
text(W-M-92,719,'扫码打开 Jira · 需登录',8.2,'CN',MUTED)
endpage()

# PAGE 4: manager decision routine, independent of implementation details.
header(4,'04 / 每天五分钟','经理怎样判断：进度正常吗',
       '只做三种判断：按计划推进、需要协调、需要重新安排日期或范围。')
checks=[
('1','看最近的交付目标','本周看 09-18 真机 demo；下周看 09-23 AWS 上线。'),
('2','看还没完成的关键子票','哪一项没完成，会让整条流程无法演示或无法上线？'),
('3','看卡点是否说清楚','在等什么、等谁、何时能回复？经理是否需要提供资料或决定？'),
('4','看完成证据','要求演示、录屏或检查结果；不需要自己阅读代码。'),
('5','定下一步行动','明确一个负责人、一个具体动作、一个反馈时间。'),
]
for i,(num,title,body) in enumerate(checks):
    y=151+i*54
    box(M,y,28,28,fill=PALE,radius=14)
    text(M+10,y+5,num,12,'CNBold',ACCENT)
    text(M+41,y-1,title,12,'CNBold')
    para(body,M+41,y+21,CW-41,10.5,16,maxh=16)
    if i<4:rule(y+46,M+41,CW-41)

box(M,434,CW,93,fill=PALE)
label('例子：数量完成，不等于交付就绪',M+13,446)
para('<b>假设</b> KAN-19 的 4 张子票已完成 3 张，剩下“真实 iPhone 验收”。<br/>'
     '正确判断：部分功能已做好，但周五 demo 仍未通过最终验证。<br/>'
     '下一步：确认谁拿真机测试、何时给结果、失败后由谁修复。',M+13,466,CW-26,10.6,17,maxh=51)

para('<b>不要被这三个信号误导：</b>3/4 不等于做完 75% 的工作量；<br/>'
     '“代码已提交（push）”不等于能用；子票全完成也要看父票整体验收。',
     M,540,CW,10.5,17,maxh=34)

label('经理每次只问三句话',M,591)
para('① 现在多了什么能实际使用的能力？<br/>'
     '② 距离下一次交付，还差哪件关键工作？<br/>'
     '③ 需要我做什么决定，最晚什么时候给答复？',M,612,CW,11,18,maxh=54)

text(M,681,'今天需协调：________________  负责人：________  反馈时间：________',10,'CN',INK)
rule(708)
para('依据：本仓库 ROADMAP、产品方向与执行原则、Jira 执行清单（2026-09-15）。<br/>'
     'Jira 通用说明：<link href="https://support.atlassian.com/jira-cloud-administration/docs/what-are-issue-statuses-priorities-and-resolutions/">'
     '<u>Atlassian Support：工作项状态、优先级与解决结果</u></link>（support.atlassian.com）。',
     M,716,CW,8.0,12,color=MUTED,maxh=24)
endpage()
c.save()
print(OUT)
