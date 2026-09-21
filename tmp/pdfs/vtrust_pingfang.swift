import Foundation
import AppKit
import CoreText
import CoreGraphics
let out = "output/pdf/VTrust_AI_Vision_会议速查表_苹方.pdf"
var media = CGRect(x:0,y:0,width:595.28,height:841.89)
let ctx = CGContext(URL(fileURLWithPath:out) as CFURL, mediaBox:&media, nil)!
let W:CGFloat=595.28, H:CGFloat=841.89, M:CGFloat=43, CW:CGFloat=509.28
func color(_ hex:Int)->CGColor { CGColor(red:CGFloat((hex>>16)&255)/255,green:CGFloat((hex>>8)&255)/255,blue:CGFloat(hex&255)/255,alpha:1) }
let ink=0x20333E, muted=0x566771, teal=0x176B73
@discardableResult func text(_ s:String,_ x:CGFloat,_ y:CGFloat,_ size:CGFloat=11.5,_ width:CGFloat=509.28,_ bold:Bool=false,_ rgb:Int=0x20333E)->CGFloat {
 let font=CTFontCreateWithName((bold ? "PingFangSC-Semibold":"PingFangSC-Regular") as CFString,size,nil)
 let para=NSMutableParagraphStyle();para.lineSpacing=4;para.lineBreakMode = .byWordWrapping
 let a=NSAttributedString(string:s,attributes:[.font:font,.foregroundColor:color(rgb),.paragraphStyle:para])
 let fs=CTFramesetterCreateWithAttributedString(a)
 let fit=CTFramesetterSuggestFrameSizeWithConstraints(fs,CFRange(location:0,length:0),nil,CGSize(width:width,height:2000),nil)
 let h=ceil(fit.height)+2
 let path=CGPath(rect:CGRect(x:x,y:H-y-h,width:width,height:h),transform:nil)
 CTFrameDraw(CTFramesetterCreateFrame(fs,CFRange(location:0,length:0),path,nil),ctx)
 return y+h
}
func rule(_ y:CGFloat){ctx.setStrokeColor(color(0xD9E1E4));ctx.setLineWidth(0.6);ctx.move(to:CGPoint(x:M,y:H-y));ctx.addLine(to:CGPoint(x:W-M,y:H-y));ctx.strokePath()}
func label(_ s:String,_ y:CGFloat){text(s,M,y,13,CW,true,teal)}
func foot(_ n:Int){rule(792);text("VTrust  /  内部方向与试用范围讨论稿  /  2026.09.17",M,802,8.5,CW,false,muted);text(String(format:"%02d / 02",n),W-M-42,802,8.5,45,false,muted)}
func start(){ctx.beginPDFPage(nil);ctx.textMatrix = .identity}
start()
text("MEETING NOTES  /  01",M,29,9,CW,true,teal)
text("VTrust AI Vision",M,50,28,CW,true)
text("从翻房 SaaS，到公司的智能工作系统",M,91,16,CW,true)
text("9月17日 14:00  ·  Ryan / George（PM）/ Jessie / VP",M,120,10,CW,false,muted)
rule(145)
label("共同方向",161)
text("让信息在工作中自然留下，让负责人看清进展，\n让管理层问得到有依据的答案。",M,189,16,CW,true)
text("先在翻房业务验证价值，再把有效做法逐步扩展到公司其他业务。",M,245,11,CW,false,muted)
let col:CGFloat=157
for (i,item) in [("员工少填表","一句话、一张照片，整理成项目记录或待确认的任务更新。"),("负责人少催进度","看清谁在做、卡在哪里、缺什么，以及下一步找谁。"),("管理层少追问","查询卡点、原因和负责人，答案附来源与更新时间。")].enumerated(){let x=M+CGFloat(i)*176;text(item.0,x,286,13,col,true,teal);text(item.1,x,312,11,col)}
rule(383)
label("一个真实场景，比十个功能更有用",400)
text("“橱柜拆完了，电工明天来，墙面先别封。”",M,429,14,CW,true)
text("关联具体房屋与原始资料 → AI 整理更新建议 → 有权限的人确认 → 任务与总览同步。管理层随后可直接查询卡点。",M,459,11.5)
text("这是目标场景。现场报告不等于已验收；关键审批与完成确认仍遵守业务规则。",M,507,10.2,CW,false,muted)
label("技术各司其职，业务结果只有一套",549)
let roles=[("微信／企微","计划中的员工入口；接入方式与授权范围待验证。"),("现有业务网站","任务安排、资料核对、审批和总览的工作台。"),("AI 智能助手","整理信息、回答问题；有来源，有权限，有人工确认。"),("AWS 云基础设施","承载应用和资料，支持权限、备份与持续运行。")]
for (i,r) in roles.enumerated(){let y=CGFloat(580+i*28);text(r.0,M,y,10.8,110,true,teal);text(r.1,M+118,y,10.7,CW-118)}
rule(700)
text("今天只定：先解决什么、谁来试、怎样算通过。",M,715,12,CW,true)
text("现状：进度报告已可用；主业务的账号权限、任务交接和手机操作仍需验收。周五演示与下周试用是目标，本次确认范围和条件。",M,744,10.3,CW,false,muted)
foot(1);ctx.endPDFPage()
start()
text("DECISION SHEET  /  02",M,29,9,CW,true,teal)
text("今天带走的六个决定",M,51,25,CW,true)
text("结论写具体；未定的，写清谁补答案、何时补齐。",M,92,11,CW,false,muted)
rule(119)
let questions:[(String,String,String)]=[
("优先解决哪个问题？","追进度、找资料、任务分派、交付确认，哪一项最费事？请举最近的例子。","第一优先：                         暂缓："),
("先跑通哪一条真实流程？","选一个近期任务：谁安排、谁执行、交什么、谁确认？完成后谁需要知道？","任务：                     安排／执行／确认："),
("哪套房、哪些人先试？","建议先一套房、一个阶段、少量任务。谁真实使用？谁收集反馈？","房屋／阶段：                    参与人／反馈负责人："),
("什么能自动做，什么必须确认？","照片或语音能否先整理成草稿？谁确认完成、改期或退回？哪些资料限制可见？","自动整理：                  必须确认／权限边界："),
("怎样证明它值得继续投入？","选两条可观察的标准：本人更新、交付可追溯、减少重复追问。谁来检查？","通过标准：                       验收人／时间："),
("哪天交什么，做不完如何取舍？","周五最小演示是什么？下周二凭什么决定试用？缺项时缩范围还是改日期？","周五范围：                    试用条件／拍板人：")]
for (i,q) in questions.enumerated(){let y=CGFloat(137+i*101);text(String(format:"%02d",i+1),M,y,15,30,true,teal);text(q.0,M+38,y,13,CW-38,true);text(q.1,M+38,y+28,10.7,CW-38);text(q.2,M+38,y+66,10,CW-38,false,muted);rule(y+92)}
text("会末复述",M,755,10.5,68,true,teal);text("谁做什么、何时完成、如何验收。9/22 14:00–14:45 复核试用安排。",M+76,755,10,CW-76)
foot(2);ctx.endPDFPage();ctx.closePDF()
print(out)
