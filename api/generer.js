// api/generer.js — v2.2 — Texte exact Word fiduciaire + logo corrige

const path = require('path');
const fs   = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

module.exports.config = { api: { bodyParser: false, responseLimit: '50mb' } };

const GREEN = rgb(0, 156/255, 116/255);
const BLACK = rgb(0, 0, 0);
const GRAY  = rgb(0.5, 0.5, 0.5);
const DGRAY = rgb(0.3, 0.3, 0.3);
const WHITE = rgb(1, 1, 1);

const PW = 595.28, PH = 841.89;
const ML = 50, MR = 545, CW = MR - ML;

// ─── Parser multipart ────────────────────────────────────────────────────────
function parseForm(req) {
  return new Promise((resolve, reject) => {
    const Busboy = require('busboy');
    const bb = Busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 } });
    const fields = {}, files = {};
    bb.on('field', (n, v) => { fields[n] = v; });
    bb.on('file',  (n, f) => {
      const c = [];
      f.on('data', d => c.push(d));
      f.on('end',  () => { files[n] = Buffer.concat(c); });
      f.on('error', reject);
    });
    bb.on('finish', () => resolve({ fields, files }));
    bb.on('error', reject);
    req.pipe(bb);
  });
}

// ─── Date francaise ──────────────────────────────────────────────────────────
function dateFr(d = new Date()) {
  const m = ['janvier','fevrier','mars','avril','mai','juin',
             'juillet','aout','septembre','octobre','novembre','decembre'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Claude : extraire infos devis ───────────────────────────────────────────
async function extraireInfosDevis(buf) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buf.toString('base64') } },
      { type: 'text', text: `Extrais les infos de ce devis. Retourne UNIQUEMENT un JSON valide sans markdown :
{
  "adresseEntreprise": "rue et numero",
  "npVilleEntreprise": "NPA et ville",
  "telephoneEntreprise": "telephone(s)",
  "noDevis": "numero du devis",
  "dateDevis": "date au format JJ.MM.AAAA",
  "lignesFinancieres": [
    { "label": "Montant total brut", "montant": "X'XXX.XX", "bold": true },
    { "label": "Rabais X%", "montant": "- X'XXX.XX", "bold": false },
    { "label": "Montant total net", "montant": "X'XXX.XX", "bold": true },
    { "label": "TVA 8.1%", "montant": "X'XXX.XX", "bold": false },
    { "label": "Montant total Net, TTC", "montant": "X'XXX.XX", "bold": true }
  ]
}
Inclure uniquement les lignes presentes. Ne jamais inventer.` }
    ]}]
  });
  return JSON.parse(resp.content[0].text.replace(/```json|```/g, '').trim());
}

// ─── Helpers PDF ─────────────────────────────────────────────────────────────
function wrapText(font, text, size, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > maxW && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawWrapped(page, font, text, x, y, size, color, maxW) {
  const lh = size + 3;
  wrapText(font, text, size, maxW).forEach(l => {
    page.drawText(l, { x, y, font, size, color });
    y -= lh;
  });
  return y;
}

// Bullet avec tiret (texte exact du Word)
function drawBullet(page, R, text, x, y, maxW) {
  const dash = '- ';
  const dw = R.widthOfTextAtSize(dash, 9);
  page.drawText(dash, { x, y, font: R, size: 9, color: BLACK });
  const lh = 12;
  const lines = wrapText(R, text, 9, maxW - dw);
  lines.forEach(l => {
    page.drawText(l, { x: x + dw, y, font: R, size: 9, color: BLACK });
    y -= lh;
  });
  return y - 3;
}

// Titre d'article
function artTitle(page, B, titre, y) {
  page.drawText(titre, { x: ML, y, font: B, size: 9.5, color: BLACK });
  return y - 14;
}

// Logo a taille fixe
function drawLogo(page, logoImg, xRight, yTop) {
  if (!logoImg) return;
  const MAX_W = 100, MAX_H = 38;
  const scale = Math.min(MAX_W / logoImg.width, MAX_H / logoImg.height);
  const lw = logoImg.width * scale;
  const lh = logoImg.height * scale;
  page.drawImage(logoImg, { x: xRight - lw, y: yTop - lh, width: lw, height: lh });
}

// ─── PAGE 1 : Lettre de garde ─────────────────────────────────────────────────
async function pageLettreGarde(pdfDoc, fonts, logoImg, infos, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);

  // Logo Legato en haut a droite (meme hauteur que les coordonnees)
  drawLogo(page, logoImg, MR, PH - 42);

  let y = PH - 50;

  // Coordonnees Legato (haut gauche)
  page.drawText('Legato SA', { x: ML, y, font: B, size: 10, color: BLACK }); y -= 13;
  page.drawText('Rue de la Plaine 46', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('1400 Yverdon-les-Bains', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('024 426 77 00  .  info@legato-eg.ch', { x: ML, y, font: R, size: 9, color: BLACK });

  // Coordonnees entreprise (droite, milieu page)
  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  let ey = PH - 215;
  page.drawText(nomComplet, { x: 340, y: ey, font: B, size: 10, color: BLACK }); ey -= 13;
  if (infos.adresseEntreprise)  { page.drawText(infos.adresseEntreprise,  { x: 340, y: ey, font: R, size: 9, color: BLACK }); ey -= 12; }
  if (infos.npVilleEntreprise)  { page.drawText(infos.npVilleEntreprise,  { x: 340, y: ey, font: R, size: 9, color: BLACK }); ey -= 12; }

  // Date
  y = PH - 330;
  page.drawText(`Yverdon-les-Bains, le ${dateFr()}`, { x: ML, y, font: R, size: 9, color: BLACK });
  y -= 32;

  // Objet
  page.drawText('Concerne :', { x: ML, y, font: B, size: 9, color: BLACK });
  page.drawText("Votre exemplaire du contrat d'entreprise", { x: ML + 68, y, font: R, size: 9, color: BLACK });
  y -= 17;
  page.drawText(`Projet : ${fd.nomChantier} -- ${fd.adresseProjet}`, { x: ML, y, font: R, size: 9, color: DGRAY });
  y -= 13;
  page.drawText(`CFC ${fd.cfcNumero}  ${fd.cfcLibelle}`, { x: ML, y, font: R, size: 9, color: DGRAY });
  y -= 28;

  // Corps
  page.drawText('Madame, Monsieur,', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 17;
  y = drawWrapped(page, R,
    "Vous trouverez ci-joint votre contrat d'entreprise en deux exemplaires, les conditions generales de Legato SA ainsi que le devis correspondant. Les instructions relatives a la suite a donner figurent en page suivante.",
    ML, y, 9, BLACK, CW);
  y -= 30;
  page.drawText('Meilleures salutations,', { x: ML, y, font: R, size: 9, color: BLACK }); y -= 15;
  page.drawText('Legato SA', { x: ML, y, font: B, size: 9, color: BLACK });
}

// ─── PAGES 3+5 : Recto contrat ────────────────────────────────────────────────
async function pageContratRecto(pdfDoc, fonts, logoImg, infos, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);

  // Logo en haut a droite
  drawLogo(page, logoImg, MR, PH - 42);

  let y = PH - 48;

  // En-tete
  page.drawText('DOCUMENT CONTRACTUEL', { x: ML, y, font: R, size: 7.5, color: GRAY }); y -= 20;
  page.drawText("Contrat d'entreprise", { x: ML, y, font: B, size: 23, color: GREEN }); y -= 20;
  page.drawText(fd.nomChantier, { x: ML, y, font: R, size: 10, color: GRAY }); y -= 13;
  page.drawText(fd.adresseProjet, { x: ML, y, font: R, size: 10, color: GRAY }); y -= 20;

  // Boites MO / Entrepreneur
  const bY = y, bH = 62, bWL = 242, bWR = 235;
  const bXL = ML, bXR = ML + bWL + 14;
  page.drawRectangle({ x: bXL, y: bY - bH, width: bWL, height: bH, borderColor: GRAY, borderWidth: 0.5, color: WHITE });
  page.drawRectangle({ x: bXR, y: bY - bH, width: bWR, height: bH, borderColor: GRAY, borderWidth: 0.5, color: WHITE });

  let by = bY - 9;
  page.drawText("MAITRE D'OUVRAGE", { x: bXL+7, y: by, font: R, size: 7, color: GRAY }); by -= 13;
  page.drawText('Legato SA',              { x: bXL+7, y: by, font: B, size: 9, color: BLACK }); by -= 11;
  page.drawText('Rue de la Plaine 46',    { x: bXL+7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10;
  page.drawText('1400 Yverdon-les-Bains', { x: bXL+7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10;
  page.drawText('024 426 77 00',          { x: bXL+7, y: by, font: R, size: 8.5, color: BLACK });

  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  by = bY - 9;
  page.drawText('ENTREPRENEUR',  { x: bXR+7, y: by, font: R, size: 7, color: GRAY }); by -= 13;
  page.drawText(nomComplet,      { x: bXR+7, y: by, font: B, size: 9, color: BLACK }); by -= 11;
  if (infos.adresseEntreprise)   { page.drawText(infos.adresseEntreprise,   { x: bXR+7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10; }
  if (infos.npVilleEntreprise)   { page.drawText(infos.npVilleEntreprise,   { x: bXR+7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10; }
  if (infos.telephoneEntreprise) { page.drawText(infos.telephoneEntreprise, { x: bXR+7, y: by, font: R, size: 8.5, color: BLACK }); }

  y = bY - bH - 14;

  // CFC et devis
  page.drawText(`CFC ${fd.cfcNumero}  ${fd.cfcLibelle}`, { x: ML, y, font: B, size: 9, color: BLACK }); y -= 12;
  page.drawText(`Selon devis ${infos.noDevis || '...'} du ${infos.dateDevis || '...'}`, { x: ML, y, font: R, size: 8.5, color: GRAY }); y -= 17;

  // Recapitulatif financier
  page.drawText('Recapitulatif :', { x: ML, y, font: B, size: 9, color: BLACK }); y -= 13;
  const lignes = infos.lignesFinancieres || [];
  for (const lg of lignes) {
    const f = lg.bold ? B : R;
    page.drawText(lg.label, { x: ML, y, font: f, size: 9, color: BLACK });
    const mt = `CHF    ${lg.montant}`;
    page.drawText(mt, { x: MR - f.widthOfTextAtSize(mt, 9), y, font: f, size: 9, color: BLACK });
    y -= 12;
  }
  y -= 8;
  page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.3, color: GRAY });
  y -= 14;

  // ── ARTICLE 1 ──
  y = artTitle(page, B, 'Article 1 : Objet du contrat', y);
  y = drawBullet(page, R, "Le Maitre d'ouvrage est une entreprise generale construisant des villas ou autres batiments cles en main. Il entend confier a l'entrepreneur les travaux precites.", ML+8, y, CW-8);
  y -= 7;

  // ── ARTICLE 2 ──
  y = artTitle(page, B, 'Article 2 : Prix', y);
  y = drawBullet(page, R, "Les plus-et/ou moins-values seront precisees de cas en cas par commande ecrite du Maitre d'ouvrage.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Le Maitre d'ouvrage pourra refuser le paiement de tous travaux qu'il n'aurait pas expressement commandes ou dont le prix n'aurait pas ete expressement accepte par lui avant leur execution.", ML+8, y, CW-8);
  y -= 7;

  // ── ARTICLE 3.1 ──
  y = artTitle(page, B, 'Article 3.1 : Delais', y);
  y = drawBullet(page, R, "Avant le debut de la construction, le Maitre d'ouvrage remet a l'entrepreneur un planning indiquant la periode pendant laquelle il doit realiser les travaux qui lui incombent et un delai d'execution.", ML+8, y, CW-8);
  y = drawBullet(page, R, "L'entrepreneur s'engage a realiser les travaux pendant cette periode et delai indique. Il ne peut en aucun cas invoquer un manque ou l'absence (pour quelque motif que ce soit) de personnel pour retarder l'execution des travaux. En revanche, la societe Legato SA s'engage a faire les choix et details dans des delais acceptables.", ML+8, y, CW-8);
  y = drawBullet(page, R, "L'entrepreneur s'engage a suivre les ordres et les instructions donnes par le Maitre d'ouvrage qui est seul habilite a planifier et a coordonner la construction de l'ouvrage entre les divers maitres d'etat. L'entrepreneur a l'obligation d'assister aux reunions de chantier prevues, sur convocation du Maitre d'ouvrage.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Pour le surplus, l'art. 92 de la norme SIA 118 est applicable.", ML+8, y, CW-8);
  y -= 7;

  // ── ARTICLE 3.2 (debut — bullets 1 a 4) ──
  y = artTitle(page, B, 'Article 3.2 : Penalites', y);
  y = drawBullet(page, R, "Le planning detaille transmis par la Direction des Travaux est repute accepte en l'absence de reserve ecrite dans un delai de 5 jours ouvrables", ML+8, y, CW-8);
  y = drawBullet(page, R, "Tout retard constate par rapport au planning fera l'objet d'un courrier de constat adresse a l'entreprise", ML+8, y, CW-8);
  y = drawBullet(page, R, "L'entreprise devra mettre les moyens pour rattraper ce retard dans un delai de 3 jours ouvrables.", ML+8, y, CW-8);
  y = drawBullet(page, R, "A defaut de retablissement de la situation dans le delai imparti, une mise en demeure sera notifiee.", ML+8, y, CW-8);
}

// ─── PAGES 4+6 : Verso contrat ────────────────────────────────────────────────
async function pageContratVerso(pdfDoc, fonts, logoImg, infos, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);

  // Logo en haut a droite
  drawLogo(page, logoImg, MR, PH - 42);

  let y = PH - 55;

  // ── ARTICLE 3.2 (suite — bullets 5 a 8) ──
  y = drawBullet(page, R, "Apres mise en demeure restee sans effet, une penalite de CHF 500.- par jour calendaire de retard pourra etre appliquee, plafonnee a 10 % du montant du marche.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Tous les frais induits par le retard (coordination supplementaire, immobilisation d'autres entreprises, locations, moyens provisoires, deplacements supplementaires de la Direction des Travaux, etc.) seront factures a l'entreprise responsable.", ML+8, y, CW-8);
  y = drawBullet(page, R, "En cas de retard mettant en peril le planning general du chantier, la Direction des Travaux pourra exiger un renforcement immediat des effectifs.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Si le retard persiste malgre les mesures precitees, le Maitre d'Ouvrage se reserve le droit de faire executer tout ou partie des prestations par une entreprise tierce aux frais et risques de l'entreprise defaillante.", ML+8, y, CW-8);
  y -= 7;

  // ── ARTICLE 4 ──
  y = artTitle(page, B, 'Article 4 : Assurance de l\'entreprise selon art. 26 al. 1 de la norme SIA 118', y);
  y = drawBullet(page, R, "L'entrepreneur declare etre couvert pour les dommages causes aux personnes ou aux biens par une assurance responsabilite civile a l'egard des tiers.", ML+8, y, CW-8);
  page.drawText('Compagnie et n.  :                     .........................................................', { x: ML+8, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('Prestation maximale par dommage :       .........................................................', { x: ML+8, y, font: R, size: 9, color: BLACK }); y -= 16;

  // ── ARTICLE 5 ──
  y = artTitle(page, B, 'Article 5 : Conditions', y);
  page.drawText('5.1 Conditions de paiement (selon normes SIA 118 art. 144)', { x: ML+8, y, font: B, size: 9, color: BLACK }); y -= 13;
  y = drawBullet(page, R, "90% sur situations suivant l'avance des travaux.", ML+8, y, CW-8);
  y = drawBullet(page, R, "10% a la fin des travaux (receptionnes par le Maitre d'ouvrage), contre remise par l'entrepreneur d'une garantie bancaire ou d'assurance et apres le versement du solde du contrat d'entreprise generale par le maitre d'ouvrage.", ML+8, y, CW-8);
  y -= 5;
  page.drawText('5.2 Conditions generales', { x: ML+8, y, font: B, size: 9, color: BLACK }); y -= 13;
  y = drawBullet(page, R, "Les CONDITIONS GENERALES POUR UN CONTRAT D'ENTREPRISE de Legato SA font partie integrante du present contrat.", ML+8, y, CW-8);
  y = drawBullet(page, R, "En cas de contradiction entre divers documents du contrat, l'ordre de priorite s'etablit selon l'art. 21 al. 1 de la norme SIA 118, dans le cas d'une contre-offre selon l'art. 22 al. 4.", ML+8, y, CW-8);
  y -= 7;

  // ── ARTICLE 6 ──
  y = artTitle(page, B, 'Article 6 : Garanties', y);
  y = drawBullet(page, R, "Les garanties donnees par l'entrepreneur sur les travaux effectues contre les defauts apparents et caches sont conformes a celles prevues par la norme SIA 118, sans restriction.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Le Maitre d'ouvrage est en droit de reclamer a l'entrepreneur le remboursement integral de toute indemnite que le Maitre d'ouvrage devrait verser au proprietaire (maitre de l'ouvrage du contrat d'entreprise generale liant Legato SA) a la suite d'une faute ou d'une negligence commise par l'entrepreneur dans l'execution des travaux qui lui incombent.", ML+8, y, CW-8);
  y -= 7;

  // ── ARTICLE 7 ──
  y = artTitle(page, B, 'Article 7 : For selon art. 37 de la norme SIA 118', y);
  y = drawBullet(page, R, "Les parties conviennent qu'en cas de contestation, le for sera au lieu de situation de l'ouvrage.", ML+8, y, CW-8);
  y = drawBullet(page, R, "Le present contrat, etabli en 2 exemplaires engage, reciproquement par leur signature, l'entrepreneur (le fournisseur) et le Maitre d'ouvrage.", ML+8, y, CW-8);
  y -= 25;

  // Lieu et date
  page.drawText(`Lieu et date : Yverdon-les-Bains, le ${dateFr()}`, { x: ML, y, font: R, size: 9, color: BLACK }); y -= 35;

  // Signatures
  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  const sxR = MR - 200;
  page.drawText("Le Maitre d'ouvrage", { x: ML,  y, font: B, size: 8.5, color: BLACK });
  page.drawText("L'entrepreneur",       { x: sxR, y, font: B, size: 8.5, color: BLACK }); y -= 13;
  page.drawText('Legato SA',            { x: ML,  y, font: R, size: 9, color: BLACK });
  page.drawText(nomComplet,             { x: sxR, y, font: R, size: 9, color: BLACK }); y -= 32;
  page.drawText('Signature : ................................', { x: ML,  y, font: R, size: 9, color: BLACK });
  page.drawText('Signature : ................................', { x: sxR, y, font: R, size: 9, color: BLACK });
}

// ─── HANDLER PRINCIPAL ───────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).send('Methode non autorisee'); return; }
  try {
    const { fields, files } = await parseForm(req);

    const reqF = ['nomChantier','adresseProjet','cfcNumero','cfcLibelle','nomEntreprise','formeJuridique'];
    for (const f of reqF) {
      if (!fields[f] || !fields[f].toString().trim()) {
        res.status(400).json({ error: `Champ manquant : ${f}` }); return;
      }
    }

    const fd = {
      nomChantier:    fields.nomChantier.toString().trim(),
      adresseProjet:  fields.adresseProjet.toString().trim(),
      cfcNumero:      fields.cfcNumero.toString().trim(),
      cfcLibelle:     fields.cfcLibelle.toString().trim(),
      nomEntreprise:  fields.nomEntreprise.toString().trim(),
      formeJuridique: fields.formeJuridique.toString().trim(),
    };

    const devisBuffer = files.devis;
    if (!devisBuffer || !devisBuffer.length) {
      res.status(400).json({ error: 'Devis PDF manquant' }); return;
    }

    const infos = await extraireInfosDevis(devisBuffer);

    const assetsDir = path.join(__dirname, '..', 'assets');
    const ficheBytes = fs.readFileSync(path.join(assetsDir, 'fiche_attestations.pdf'));
    const cgBytes    = fs.readFileSync(path.join(assetsDir, 'conditions_generales.pdf'));
    const logoPath   = path.join(assetsDir, 'logo_legato.png');
    const logoBytes  = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

    const pdfDoc = await PDFDocument.create();
    const B = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const R = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fonts = { B, R };

    let logoImg = null;
    if (logoBytes) { try { logoImg = await pdfDoc.embedPng(logoBytes); } catch (_) {} }

    // 1. Lettre de garde
    await pageLettreGarde(pdfDoc, fonts, logoImg, infos, fd);

    // 2. Fiche attestations
    const fichePdf = await PDFDocument.load(ficheBytes);
    (await pdfDoc.copyPages(fichePdf, fichePdf.getPageIndices())).forEach(p => pdfDoc.addPage(p));

    // 3-4. Contrat exemplaire 1
    await pageContratRecto(pdfDoc, fonts, logoImg, infos, fd);
    await pageContratVerso(pdfDoc, fonts, logoImg, infos, fd);

    // 5-6. Contrat exemplaire 2
    await pageContratRecto(pdfDoc, fonts, logoImg, infos, fd);
    await pageContratVerso(pdfDoc, fonts, logoImg, infos, fd);

    // 7-18. Conditions generales
    const cgPdf = await PDFDocument.load(cgBytes);
    (await pdfDoc.copyPages(cgPdf, cgPdf.getPageIndices())).forEach(p => pdfDoc.addPage(p));

    // 19+. Devis x2
    const devisPdf = await PDFDocument.load(devisBuffer);
    const idx = devisPdf.getPageIndices();
    (await pdfDoc.copyPages(devisPdf, idx)).forEach(p => pdfDoc.addPage(p));
    (await pdfDoc.copyPages(devisPdf, idx)).forEach(p => pdfDoc.addPage(p));

    const pdfBytes = await pdfDoc.save();
    const nom = `Contrat_${fd.nomEntreprise.replace(/\s+/g,'_')}_CFC${fd.cfcNumero}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nom}"`);
    res.status(200).send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error('ERREUR:', err);
    res.status(500).json({ error: 'Erreur generation', detail: err.message });
  }
};
