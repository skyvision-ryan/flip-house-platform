from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import Paragraph
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.colors import HexColor
from xml.sax.saxutils import escape

pdfmetrics.registerFont(TTFont('CN','/System/Library/Fonts/Supplemental/Arial Unicode.ttf'))
W,H=A4
M=42
CW=W-2*M
OUT='tmp/pdfs/layout_reference.pdf'
pages=[[]]
c=canvas.Canvas(OUT,pagesize=A4)
c.setTitle('VTrust AI Vision | 内部试用方向会 · 会议速查表')
c.setAuthor('VTrust')
INK='#182E3D'; MUTED='#50616C'; TEAL='#176B73'; RULE='#D4DCE0'

def text(s,x,y,size=11.5,color=INK,width=CW,leading=None):
    p=Paragraph(s,ParagraphStyle('p',fontName='CN',fontSize=size,leading=leading or size*1.48,textColor=HexColor(color),wordWrap='CJK'))
    _,h=p.wrap(width,1000)
    pages[-1].append(dict(kind='text',text=s,x=x,y=y,size=size,w=width,h=h,color=color,bold=(size>=12 or color==TEAL)))
    return y+h

def line(y,x=M,width=CW,color=RULE):
    pages[-1].append(dict(kind="line",x=x,y=y,w=width,color=color))
    c.setStrokeColor(HexColor(color));c.setLineWidth(.6);c.line(x,H-y,x+width,H-y)

def section(label,y):
    text(label,M,y,13,TEAL);return y+26

def footer(page):
    line(795)
    text('VTrust · 2026/09/17 · 方向与试用范围讨论稿',M,804,9,MUTED)
    text(f'{page} / 2',W-M-36,804,9,MUTED,width=36)

def box(s,y,h=54):
    c.setFillColor(HexColor('#F0F5F6'));c.roundRect(M,H-y-h,CW,h,5,fill=1,stroke=0)
    text(s,M+12,y+9,11.5,width=CW-24)

text('VTrust AI Vision',M,32,23)
text('从翻房 SaaS，到公司的 AI Operating System',M,67,15,TEAL)
text('内部试用方向会  |  9/17 14:00  |  Ryan · George（PM）· Jessie · VP',M,96,10,MUTED)
line(120)

y=section('一句话愿景',135)
y=text('让员工在工作中顺手留下信息，让负责人掌握进展，让管理层问得到有依据的答案。先从翻房业务验证，再把有效做法逐步扩展到公司其他业务。',M,y,12)
y+=12
# Three business outcomes, not technology brands.
col=(CW-24)/3
for i,(h,b) in enumerate([
('员工少填表','一句话、一张照片，整理成项目记录或待确认的任务更新。'),
('负责人少催进度','看清谁在做、卡在哪里、缺什么，以及下一步找谁。'),
('管理层少追问','问“哪些房子卡住了”，能看到原因、负责人、来源和更新时间。')]):
    x=M+i*(col+12)
    text(h,x,y,12,TEAL,width=col)
    text(b,x,y+25,10.7,width=col)
y+=104

y=section('用一个现场场景检验方向',y)
y=text('现场人员：“橱柜拆完了，电工明天来，墙面先别封。”',M,y,12)
y=text('目标体验：关联到具体房屋和原始照片／语音 → 整理为更新建议 → 由有权限的人确认 → 任务与总览同步。管理层随后可以直接查询卡点。',M,y+7,11.5)
y=text('关键边界：现场说“完成”是待核实的报告；AI 可以提建议，关键审批和任务完成仍按业务规则确认。以上为目标场景，尚不代表已实现。',M,y+7,10.5,MUTED)
y+=17

y=section('各部分负责什么，用业务语言讲清楚',y)
rows=[('微信／企微','计划中的便捷入口；具体接入方式、可获取的消息及授权范围待验证。'),('现有业务网站','安排任务、核对记录、查看资料和审批的工作台。'),('AI 智能助手','理解材料、整理信息、回答问题；答案有来源，操作受权限约束。'),('AWS 云基础设施','承载应用、保存资料与记录，支持权限、备份和持续运行。')]
for a,b in rows:
    text(a,M,y,11,TEAL,width=106)
    bottom=text(b,M+113,y,10.6,width=CW-113)
    y=bottom+8

y=section('今天的边界与会议节奏',y+8)
y=text('现状：进度报告页已可用；主业务的账号权限、任务交接、手机操作仍需验收。先跑通真实流程，再验证 AI 整理与查询，最后才讨论跨业务扩展。',M,y,11)
y=text('建议 45 分钟：5 分钟现状与愿景 → 10 分钟真实案例 → 20 分钟六项决定 → 5 分钟手机看报告 → 5 分钟复述结论。',M,y+8,11)
y=text('今天不展开：模型品牌比较、全公司平台架构、全流程一次上线。9/18 演示与下周试用仍是目标，范围和条件需本次确认。',M,y+8,10.3,MUTED)
assert y<785,y
footer(1);c.showPage();pages.append([])

text('今天必须带走的 6 个决定',M,32,21)
text('主持人速查表  |  每题写结论；未定的写清“谁补答案、何时补齐”。',M,68,10.5,MUTED)
line(96)
items=[
('01  优先解决哪个问题？','追进度、找资料、任务分派、交付确认，哪一项目前最费事？请说一个最近发生的例子。','第一优先：____________________  暂缓：____________________'),
('02  先跑通哪一条真实流程？','选一个近期任务：谁安排、谁执行、交什么、谁确认？完成后谁需要知道？','任务：________________  安排／执行／确认：________________'),
('03  哪套房、哪些人先试？','建议先一套房、一个阶段、少量任务。谁愿意真实使用？由谁收集反馈？','房屋／阶段：________________  参与人／反馈负责人：____________'),
('04  什么能自动做，什么必须确认？','照片或语音能否先整理成草稿？谁确认完成、改期或退回？哪些资料仅特定人可见？','自动整理：____________  必须确认／权限边界：________________'),
('05  怎样证明它值得继续投入？','选两条可观察的标准：本人更新、交付可追溯、无需重复追问。谁在什么时间检查？','通过标准：____________________  验收人／时间：______________'),
('06  哪天交什么，做不完如何取舍？','周五最小演示包含什么？下周二凭什么决定能否试用？缺项时缩范围还是改日期，由谁定？','周五范围：________________  试用条件／拍板人：______________')]
y=110
for h,q,write in items:
    text(h,M,y,13,TEAL)
    end=text(q,M,y+25,11.2)
    text(write,M,end+10,10.4,MUTED)
    line(y+100)
    y+=107
text('会末复述',M,758,10.5,TEAL,width=62)
text('谁做什么、何时完成、如何验收。下周二 9/22 14:00–14:45 复核并决定试用安排。',M+67,758,10,width=CW-67)
footer(2)
c.save()
import json
open('tmp/pdfs/pingfang_layout.json','w').write(json.dumps(pages,ensure_ascii=False))
