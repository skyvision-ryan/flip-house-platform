#import <AppKit/AppKit.h>
#import <CoreText/CoreText.h>
CGColorRef color(NSString *s){unsigned v=0;[[NSScanner scannerWithString:[s stringByReplacingOccurrencesOfString:@"#" withString:@""]] scanHexInt:&v];return CGColorCreateGenericRGB(((v>>16)&255)/255.,((v>>8)&255)/255.,(v&255)/255.,1);}
int main(int argc,char **argv){@autoreleasepool{
NSArray *pages=[NSJSONSerialization JSONObjectWithData:[NSData dataWithContentsOfFile:@(argv[1])] options:0 error:nil];
CGRect bounds=CGRectMake(0,0,595.28,841.89);CGContextRef c=CGPDFContextCreateWithURL((__bridge CFURLRef)[NSURL fileURLWithPath:@(argv[2])],&bounds,NULL);
for(NSArray *page in pages){CGPDFContextBeginPage(c,NULL);for(NSDictionary *d in page){
CGFloat x=[d[@"x"] doubleValue],y=[d[@"y"] doubleValue],w=[d[@"w"] doubleValue];CGColorRef clr=color(d[@"color"]);
if([d[@"kind"] isEqual:@"line"]){CGContextSetStrokeColorWithColor(c,clr);CGContextSetLineWidth(c,.6);CGContextMoveToPoint(c,x,841.89-y);CGContextAddLineToPoint(c,x+w,841.89-y);CGContextStrokePath(c);}
else{CGFloat size=[d[@"size"] doubleValue],h=[d[@"h"] doubleValue]+8;CTFontRef font=CTFontCreateWithName((__bridge CFStringRef)([d[@"bold"] boolValue]?@"PingFangSC-Semibold":@"PingFangSC-Regular"),size,NULL);NSMutableParagraphStyle *p=[NSMutableParagraphStyle new];p.lineSpacing=size*.35;
NSAttributedString *s=[[NSAttributedString alloc]initWithString:d[@"text"] attributes:@{NSFontAttributeName:(__bridge id)font,NSForegroundColorAttributeName:(__bridge id)clr,NSParagraphStyleAttributeName:p}];CTFramesetterRef fs=CTFramesetterCreateWithAttributedString((__bridge CFAttributedStringRef)s);CGPathRef path=CGPathCreateWithRect(CGRectMake(x,841.89-y-h,w,h),NULL);CTFrameRef f=CTFramesetterCreateFrame(fs,CFRangeMake(0,0),path,NULL);CTFrameDraw(f,c);CFRelease(f);CFRelease(path);CFRelease(fs);CFRelease(font);}
CGColorRelease(clr);
}CGPDFContextEndPage(c);}CGPDFContextClose(c);CGContextRelease(c);}}
