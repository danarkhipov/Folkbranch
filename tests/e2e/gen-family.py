# A bushy family: every couple has 2-4 children, about seven generations, the shape real archives have.
import sys,random
random.seed(7); N=int(sys.argv[1]); indi=[]; fam=[]; n=0
def p(sex,y):
    global n; n+=1; i=n
    indi.append(f"0 @I{i}@ INDI\n1 NAME Имя{i} /Род{i%40}/\n1 SEX {sex}\n1 BIRT\n2 DATE {y}\n1 DEAT\n2 DATE {y+70}")
    return i
q=[(p('M',1700),p('F',1702),1725)]; f=0
while q and n<N:
    h,w,y=q.pop(0); f+=1; kids=[]
    for j in range(random.choice([2,3,3,4])):
        kids.append((p(random.choice('MF'),y+j*2),y+j*2))
    fam.append(f"0 @F{f}@ FAM\n1 HUSB @I{h}@\n1 WIFE @I{w}@\n"+"\n".join(f"1 CHIL @I{k}@" for k,_ in kids))
    for k,ky in kids:
        if n>=N: break
        sex=[l for l in indi if l.startswith(f"0 @I{k}@")][0].split("SEX ")[1][0]
        sp=p('F' if sex=='M' else 'M',ky+1)
        q.append((k,sp,ky+25) if sex=='M' else (sp,k,ky+25))
print("0 HEAD\n1 CHAR UTF-8\n"+"\n".join(indi+fam)+"\n0 TRLR")
