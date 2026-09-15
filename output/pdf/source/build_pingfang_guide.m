#import <AppKit/AppKit.h>
#import <CoreImage/CoreImage.h>

static CGContextRef ctx;
static CGFloat W=612,H=792,M=44,CW=524;
static NSColor *ink,*muted,*accent,*pale,*rules,*light;
static NSColor *RGB(unsigned v){return [NSColor colorWithSRGBRed:((v>>16)&255)/255.0 green:((v>>8)&255)/255.0 blue:(v&255)/255.0 alpha:1];}
static NSFont *Font(CGFloat size,NSString *weight){
    NSFont *f=[NSFont fontWithName:[@"PingFangSC-" stringByAppendingString:weight] size:size];
    if(!f){NSLog(@"Missing PingFang SC %@",weight);exit(2);}return f;
}
static void Draw(NSString *s,CGFloat x,CGFloat top,CGFloat w,CGFloat h,CGFloat size,CGFloat lead,NSString *weight,NSColor *tint,NSTextAlignment alignment){
    NSMutableParagraphStyle *p=[NSMutableParagraphStyle new];p.alignment=alignment;p.minimumLineHeight=lead;p.maximumLineHeight=lead;p.lineBreakMode=NSLineBreakByWordWrapping;
    NSAttributedString *a=[[NSAttributedString alloc] initWithString:s attributes:@{NSFontAttributeName:Font(size,weight),NSForegroundColorAttributeName:tint,NSParagraphStyleAttributeName:p}];
    NSStringDrawingOptions options=NSStringDrawingUsesLineFragmentOrigin|NSStringDrawingUsesFontLeading;
    CGFloat used=[a boundingRectWithSize:NSMakeSize(w,1500) options:options].size.height;
    if(used>h+1){NSLog(@"Overflow %.1f > %.1f: %@",used,h,s);exit(3);}
    [a drawWithRect:NSMakeRect(x,H-top-h,w,h) options:options];
}
#define T(s,x,y,w,h,sz,ld,wt,col) Draw(s,x,y,w,h,sz,ld,wt,col,NSTextAlignmentLeft)
static void Line(CGFloat y,CGFloat x,CGFloat w){CGContextSetStrokeColorWithColor(ctx,rules.CGColor);CGContextSetLineWidth(ctx,.55);CGContextMoveToPoint(ctx,x,H-y);CGContextAddLineToPoint(ctx,x+w,H-y);CGContextStrokePath(ctx);}
static void FillBox(CGFloat x,CGFloat top,CGFloat w,CGFloat h){CGContextSetFillColorWithColor(ctx,pale.CGColor);CGContextFillRect(ctx,CGRectMake(x,H-top-h,w,h));}
static void Begin(int n,NSString *section,NSString *title,NSString *sub){
    CGPDFContextBeginPage(ctx,NULL);[NSGraphicsContext saveGraphicsState];[NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithCGContext:ctx flipped:NO]];
    T(@"翻房工作平台  /  方向与进度",M,29,300,16,9.3,14,@"Regular",muted);
    Draw(@"管理者阅读版",425,29,143,16,9.3,14,@"Regular",muted,NSTextAlignmentRight);Line(53,M,CW);
    T(section,M,68,410,17,10.4,16,@"Medium",accent);
    Draw([NSString stringWithFormat:@"%02d",n],499,60,69,47,37,44,@"Semibold",light,NSTextAlignmentRight);
    T(title,M,96,CW,39,26,36,@"Semibold",ink);T(sub,M,142,CW,38,11.5,18,@"Regular",muted);
    Line(746,M,CW);T(@"2026年9月15日修订 · 日期按洛杉矶时间",M,757,380,16,8.5,14,@"Regular",muted);
    Draw([NSString stringWithFormat:@"%d / 3",n],502,757,66,16,9,14,@"Regular",muted,NSTextAlignmentRight);
}
static void End(void){[NSGraphicsContext restoreGraphicsState];CGPDFContextEndPage(ctx);}

int main(void){@autoreleasepool{
    ink=RGB(0x202c29);muted=RGB(0x64706b);accent=RGB(0x314f43);pale=RGB(0xf3f5f2);rules=RGB(0xcbd2ca);light=RGB(0xdfe5de);
    NSString *path=@"/Users/Ryan/Documents/GitHub/flip-house-platform/output/pdf/项目目标与看进度指南_通俗版_2026-09-15.pdf";
    CGDataConsumerRef consumer=CGDataConsumerCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:path]);
    CGRect media=CGRectMake(0,0,W,H);
    NSDictionary *meta=@{(__bridge NSString*)kCGPDFContextTitle:@"项目目标与看进度指南 · 通俗版",(__bridge NSString*)kCGPDFContextAuthor:@"翻房项目团队",(__bridge NSString*)kCGPDFContextSubject:@"苹方简体中文 · 面向管理者的阶段目标与进度说明"};
    ctx=CGPDFContextCreate(consumer,&media,(__bridge CFDictionaryRef)meta);

    Begin(1,@"未来目标",@"未来，我们分六步走",@"每套房的工作，都能说清：谁在做、做到哪、还缺什么、最后结果如何。");
    FillBox(M,183,CW,38);T(@"现在已有可以展示的初步版本。以下是下一步目标，尚待完成。",M+12,193,CW-24,21,11.1,18,@"Medium",ink);
    NSArray *stages=@[
      @[@"先演示一次完整合作",@"9月18日",@"负责人安排工作；同事用手机看要求、交照片；负责人检查。",@"做到：两个人能按顺序做完，双方看到相同结果。"],
      @[@"让一小批同事开始日常使用",@"9月21日至25日",@"先用在 2-3 套在建房；同事在不同地方也能打开使用。",@"做到：各用各的账号，资料长期保存，出问题能找回记录。"],
      @[@"让工作更顺手，记录更完整",@"内部用起来之后",@"哪里还要反复发消息追问，就改哪里；补齐工作和费用记录。",@"做到：谁做了什么、为什么延误、钱花在哪，都能查清楚。"],
      @[@"让人工智能帮忙查资料、写汇报",@"记录可靠之后",@"例如问“这套房现在卡在哪里？”，它能找到记录并解释。",@"做到：答案有依据；要改工作安排时，先请人确认。"],
      @[@"把成熟工具提供给其他公司",@"外部团队试用后",@"把我们验证过的工作办法，做成别人也能使用的工具。",@"做到：其他团队愿意继续用并付费，各公司的资料互不混淆。"],
      @[@"帮助处理更多房产工作",@"翻房业务成熟后",@"再结合过往项目经验，帮助比较装修、费用和出售方案。",@"做到：说得出理由，事后能核对效果，再逐步扩大用途。"]];
    for(NSUInteger i=0;i<stages.count;i++){
      NSArray *r=stages[i];CGFloat y=238+i*76;
      T(([NSString stringWithFormat:@"%02lu",(unsigned long)i+1]),M,y-1,30,24,15,23,@"Medium",accent);
      T(r[0],M+42,y,350,23,13.2,22,@"Semibold",ink);
      Draw(r[1],428,y+2,140,20,9.9,18,@"Regular",muted,NSTextAlignmentRight);
      T(r[2],M+42,y+25,CW-42,20,10.9,18,@"Regular",ink);T(r[3],M+42,y+45,CW-42,20,10.9,18,@"Regular",ink);
      if(i<5)Line(y+69,M+42,CW-42);
    }
    T(@"后面四个阶段还没有定日期；先看前一步是否好用，再安排下一步。",M,716,CW,20,10.4,18,@"Regular",muted);End();

    Begin(2,@"近期安排",@"这两周，要看到什么变化",@"听汇报时，只要问：“请当场做给我看，这件事现在能不能完成？”");
    NSArray *milestones=@[
      @[@"16",@"同事各自进入自己的工作页面",@"每个人用自己的账号，看到自己可以处理的房屋和工作。",@"两个人分别进入，资料各自正确，不会看到不该看的内容。"],
      @[@"17",@"把每套房的工作安排清楚",@"做什么、谁负责、什么时候交、交哪些材料，都写在一处。",@"两套房的工作不会混在一起；材料没交齐，不能算完成。"],
      @[@"18",@"用手机完成一次工作交接",@"安排工作 → 手机看要求 → 交照片或文件 → 负责人检查。",@"拿真正的手机做一遍；关掉页面再打开，记录和结果还在。"],
      @[@"23",@"达到团队日常使用的条件",@"不必靠某一台办公电脑一直开着，在不同地方都能使用。",@"更新软件不丢资料；出了故障，也能找回记录、恢复使用。"]];
    for(NSUInteger i=0;i<milestones.count;i++){
      NSArray *r=milestones[i];CGFloat y=193+i*119;
      T(@"9月",M,y+1,62,18,10.5,17,@"Medium",muted);T(r[0],M,y+23,66,43,29,40,@"Semibold",accent);
      T(r[1],M+100,y,CW-100,26,14.2,23,@"Semibold",ink);
      T(@"能做什么",M+100,y+36,62,20,10.4,18,@"Medium",muted);T(r[2],M+170,y+36,CW-170,40,11.1,18,@"Regular",ink);
      T(@"怎么检查",M+100,y+73,62,20,10.4,18,@"Medium",muted);T(r[3],M+170,y+73,CW-170,40,11.1,18,@"Regular",ink);
      if(i<3)Line(y+112,M,CW);
    }
    FillBox(M,681,CW,51);T(@"9月24日至25日，先选 2-3 套在建房使用，记下哪里还不顺手。",M+12,690,CW-24,20,11,18,@"Medium",ink);
    T(@"这两周最重要的事：工作说清楚，资料不丢，负责人能检查结果。",M+12,711,CW-24,18,10.7,17,@"Regular",ink);End();

    Begin(3,@"看懂进度",@"看进度，只找五个答案",@"Jira 是记录“软件做到哪一步”的网页，可以当成一本工作进度本。\n这里看的是做软件的进度，不是房屋施工进度。");
    NSArray *answers=@[
      @[@"要做成什么？",@"读说明中的目标：做好以后，同事能实际完成什么事？"],
      @[@"谁负责？",@"看“经办人”：就是负责这项工作、需要说明进展的人。"],
      @[@"什么时候能用？",@"看说明里的“目标日期”；日期变了，要问清原因。"],
      @[@"现在做到哪？",@"看“状态”和最近的说明，再问：还有什么没有做好？"],
      @[@"怎么证明做好？",@"请负责人实际操作一次，或提供操作录像和检查结果。"]];
    for(NSUInteger i=0;i<answers.count;i++){
      NSArray *r=answers[i];CGFloat y=196+i*46;
      T(r[0],M,y+8,123,24,12.2,21,@"Semibold",ink);T(r[1],M+138,y+9,CW-138,25,11.1,20,@"Regular",ink);Line(y+42,M,CW);
    }
    T(@"页面上的几个词，分别是什么意思",M,443,CW,25,12.8,23,@"Semibold",ink);
    NSArray *states=@[@[@"待办",@"还没开始"],@[@"进行中",@"正在做"],@[@"审查中",@"等人检查"],@[@"已完成",@"已标记做完，仍要看结果"]];
    for(NSUInteger i=0;i<states.count;i++){
      NSArray *r=states[i];CGFloat x=M+i*134;
      T(r[0],x,478,122,23,12.1,21,@"Medium",accent);T(r[1],x,505,122,20,10,18,@"Regular",muted);
    }
    FillBox(M,545,CW,83);T(@"不要只看完成了多少项。",M+13,555,CW-26,22,12,21,@"Semibold",ink);
    T(@"举例：十项工作做完九项，但手机还不能正常用，就仍没达到本周目标。",M+13,582,CW-26,20,10.9,18,@"Regular",ink);
    T(@"经理只追问：还差什么？谁来解决？什么时候给我看结果？",M+13,604,CW-26,20,11,18,@"Medium",ink);
    T(@"打开进度页面",M,652,CW-108,23,12.5,22,@"Semibold",ink);
    T(@"扫码进入本周的手机使用目标，需要登录。\n也可以请负责人把工作页面的链接发来。\n进入后，先读目标，再看谁负责、日期和最近说明。",M,684,CW-106,54,10.6,17,@"Regular",muted);
    NSString *qrURL=@"https://skyvisioninsurance.atlassian.net/browse/KAN-19";
    CIFilter *f=[CIFilter filterWithName:@"CIQRCodeGenerator"];
    [f setValue:[qrURL dataUsingEncoding:NSUTF8StringEncoding] forKey:@"inputMessage"];[f setValue:@"M" forKey:@"inputCorrectionLevel"];
    CIImage *qr=[[f valueForKey:kCIOutputImageKey] imageByApplyingTransform:CGAffineTransformMakeScale(10,10)];
    CIContext *ci=[CIContext contextWithOptions:@{kCIContextUseSoftwareRenderer:@YES}];CGImageRef image=[ci createCGImage:qr fromRect:qr.extent];
    CGContextSaveGState(ctx);CGContextSetInterpolationQuality(ctx,kCGInterpolationNone);CGContextDrawImage(ctx,CGRectMake(493,H-729,67,67),image);CGContextRestoreGState(ctx);CGImageRelease(image);
    CGPDFContextSetURLForRect(ctx,(__bridge CFURLRef)[NSURL URLWithString:qrURL],CGRectMake(485,H-737,83,83));End();
    CGPDFContextClose(ctx);CGContextRelease(ctx);CGDataConsumerRelease(consumer);
    NSLog(@"Wrote %@",path);for(NSString *weight in @[@"Regular",@"Medium",@"Semibold"])NSLog(@"Font: %@",Font(12,weight).fontName);
}return 0;}
