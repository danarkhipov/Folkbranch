#!/usr/bin/env python3
# An invented family with long surnames, second marriages and cousins marrying: the shape that crosses lines on a chart.
import sys
S=['Воскресенский-Петропавловский','Преображенская-Богоявленская','Соколов','Арсеньева','Константинопольский','Иванова','Ромашов','Белозерская-Трубецкая','Кузнецов','Рождественская']
indi=[];fam=[];n=0
def p(name,sex,y,s):
    global n;n+=1
    indi.append(f"0 @I{n}@ INDI\n1 NAME {name} /{s}/\n1 SEX {sex}\n1 BIRT\n2 DATE {y}\n1 DEAT\n2 DATE {y+66}")
    return n
def f(h,w,kids):
    fam.append(f"0 @F{len(fam)+1}@ FAM\n1 HUSB @I{h}@\n1 WIFE @I{w}@\n"+"\n".join(f"1 CHIL @I{k}@" for k in kids))
a=p('Пётр','M',1800,S[0]);b=p('Мария','F',1803,S[1]);c=p('Иван','M',1802,S[4]);d=p('Анна','F',1805,S[7])
e=p('Николай','M',1826,S[0]);g=p('Елизавета','F',1828,S[0]);h=p('Павел','M',1830,S[0])
i=p('Ольга','F',1829,S[4]);j=p('Сергей','M',1827,S[4]);k=p('Вера','F',1832,S[4])
f(a,b,[e,g,h]);f(c,d,[i,j,k]);f(e,i,[]);f(j,g,[]);f(h,k,[])
m=p('Дарья','F',1835,S[9]);f(e,m,[])
# Children of the crossing couples, then their own marriages across the two lines.
kids=[]
for x,(h1,w1) in enumerate([(e,i),(j,g),(h,k),(e,m)]):
    ch=[p(nm,sx,1852+x*2,S[0] if h1 in(e,h) else S[4]) for nm,sx in (('Александр','M'),('Татьяна','F'),('Владимир','M'))]
    fam[[e,j,h,e].index(h1)+2 if x<3 else 5]=fam[[e,j,h,e].index(h1)+2 if x<3 else 5]+"\n"+"\n".join(f"1 CHIL @I{q}@" for q in ch)
    kids.append(ch)
sp=[p('Людмила','F',1858,S[3]),p('Георгий','M',1857,S[6]),p('Наталья','F',1860,S[5]),p('Дмитрий','M',1856,S[8])]
f(kids[0][0],kids[1][1],[p('Борис','M',1880,S[0]),p('Ксения','F',1882,S[0])])
f(kids[1][0],kids[2][1],[p('Глеб','M',1884,S[4])])
f(kids[3][0],sp[0],[p('Роман','M',1883,S[0])])
f(sp[1],kids[3][1],[p('Лидия','F',1885,S[6])])
print("0 HEAD\n1 CHAR UTF-8\n"+"\n".join(indi+fam)+"\n0 TRLR")
