-- Le lingue e quali regioni le pubblicano. Stavano nel seed di prova, ma
-- non sono dati di prova: senza 'en' l'import non può scrivere un nome di
-- evento (FK su locale). Da quando il seed carica solo nei test, devono
-- esistere in ogni database, e il posto per questo è una migrazione.
--
-- Si segue il gioco: Japan in giapponese (più l'inglese tradotto da noi),
-- Global nelle lingue che il gioco pubblica. Niente italiano, per ora.
insert into locale (code, label, native_label) values
  ('en', 'English', 'English'),
  ('ja', 'Japanese', '日本語')
on conflict (code) do nothing;

insert into region_locale (reg, locale, official) values
  ('japan', 'ja', true),
  ('japan', 'en', false),   -- traduzione nostra / della community
  ('global', 'en', true)
on conflict (reg, locale) do nothing;
