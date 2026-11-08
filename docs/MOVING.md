# Moving from Gramps, webtrees or another program

Export a GEDCOM file from your program, then in Folkbranch open **Settings → Data and backups → Add people from a file**. You see what the file holds before anything changes, and one undo takes the whole import back.

**Gramps:** Family Trees → Export → GEDCOM. **webtrees:** Control panel → Family trees → Export, as GEDCOM. **Ancestry, MyHeritage, Geni:** each has an export to GEDCOM in its tree settings.

## What comes across

Checked on files written the way Gramps 6 and webtrees 2.2 write them, in `tests/moving.test.ts`:

- Names, with the patronymic split off, the surname from birth (a second `NAME` of type birth or maiden, or Gramps' `_MARNM`) and other names.
- Dates in any GEDCOM form: exact, about, between, before, after, and periods such as a residence from 1900 to 1910.
- Birth, death and their places; baptism, burial, occupation, residence, education, religion, census, emigration and other events as facts.
- Notes, including shared ones, as a biography page.
- Sources with their archive and sheet, and how sure each citation is.
- Families, marriages, divorces and adoptions.
- Godparents and witnesses (`ASSO`), as a fact naming the person.
- Someone marked private (`RESN confidential` or `privacy`) stays hidden from readers.

## What does not

- **Photos and other files.** A GEDCOM file only names them. Upload the photos to each person afterwards. The preview says how many links to files it found.
- **Research notes kept outside people and families,** such as Gramps tasks or webtrees' stories and news.

The preview lists any other part of the file it will not read, by its GEDCOM name, before you decide.

## Going back

**Settings → Data and backups → Download the .ged file** writes everyone with their sources and facts, so Gramps, webtrees and the others read it. Someone kept private is marked so in the file. A full copy of the archive, with pages and photos, is a separate download on the same screen.
