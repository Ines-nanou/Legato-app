// api/generer.js — Générateur de contrats prestataires Legato SA — v2
// Champs manuels : nomChantier, adresseProjet, cfcNumero, cfcLibelle, nomEntreprise, formeJuridique
// L'IA extrait uniquement : coordonnées secondaires, n° devis, date, récapitulatif financier

const path = require('path');
const fs = require('fs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// Désactiver le body parser Vercel — on gère le multipart nous-mêmes
module.exports.config = {
  api: {
    bodyParser: false,
    responseLimit: '50mb',
  },
};

// ─── Couleurs ────────────────────────────────────────────────────────────────
const GREEN  = rgb(0, 156 / 255, 116 / 255); // Vert Legato #009C74
const BLACK  = rgb(0, 0, 0);
const GRAY   = rgb(0.5, 0.5, 0.5);
const DGRAY  = rgb(0.3, 0.3, 0.3);
const WHITE  = rgb(1, 1, 1);

// ─── Dimensions A4 (en points) ───────────────────────────────────────────────
const PW = 595.28;
const PH = 841.89;
const ML = 50;   // marge gauche
const MR = 545;  // marge droite (PW - 50)
const CW = MR - ML; // largeur du contenu = 495

// ─── Parser multipart avec busboy ────────────────────────────────────────────
function parseForm(req) {
  return new Promise((resolve, reject) => {
    let Busboy;
    try { Busboy = require('busboy'); } catch (e) { return reject(new Error('busboy non disponible')); }

    const busboy = Busboy({ headers: req.headers, limits: { fileSize: 50 * 1024 * 1024 } });
    const fields = {};
    const files  = {};

    busboy.on('field', (name, value) => { fields[name] = value; });

    busboy.on('file', (name, file) => {
      const chunks = [];
      file.on('data',  chunk => chunks.push(chunk));
      file.on('end',   ()    => { files[name] = Buffer.concat(chunks); });
      file.on('error', reject);
    });

    busboy.on('finish', () => resolve({ fields, files }));
    busboy.on('error',  reject);
    req.pipe(busboy);
  });
}

// ─── Date en français ────────────────────────────────────────────────────────
function dateFr(d = new Date()) {
  const m = ['janvier','fevrier','mars','avril','mai','juin',
             'juillet','aout','septembre','octobre','novembre','decembre'];
  return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`;
}

// ─── Appel Claude pour extraire les infos du devis ───────────────────────────
async function extraireInfosDevis(devisBuffer) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const b64 = devisBuffer.toString('base64');

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: b64 },
        },
        {
          type: 'text',
          text: `Tu es un assistant qui extrait des informations de devis de construction.
Lis ce devis et retourne UNIQUEMENT un JSON valide (sans markdown, sans commentaires) avec ces champs :
{
  "adresseEntreprise": "rue et numero de l'entreprise auteur du devis",
  "npVilleEntreprise": "NPA et ville de l'entreprise",
  "telephoneEntreprise": "numero(s) de telephone de l'entreprise",
  "noDevis": "numero de reference du devis",
  "dateDevis": "date du devis au format JJ.MM.AAAA",
  "lignesFinancieres": [
    { "label": "Montant total brut", "montant": "XXX'XXX.XX", "bold": true },
    { "label": "Rabais 3%", "montant": "- X'XXX.XX", "bold": false },
    { "label": "Montant total net", "montant": "XXX'XXX.XX", "bold": true },
    { "label": "TVA 8.10%", "montant": "X'XXX.XX", "bold": false },
    { "label": "Montant total net, TTC", "montant": "XXX'XXX.XX", "bold": true }
  ]
}
Inclure uniquement les lignes financieres reellement presentes dans le devis.
Ne jamais inventer des valeurs. Si une info est absente, mettre une chaine vide.`,
        },
      ],
    }],
  });

  const txt   = resp.content[0].text;
  const clean = txt.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

// ─── Wrapping de texte (retourne un tableau de lignes) ───────────────────────
function wrapText(font, text, size, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

// Dessine du texte avec retour à la ligne automatique, retourne le Y final
function drawWrapped(page, font, text, x, y, size, color, maxWidth) {
  const lines = wrapText(font, text, size, maxWidth);
  const lh = size + 3;
  for (const l of lines) {
    page.drawText(l, { x, y, font, size, color });
    y -= lh;
  }
  return y;
}

// ─── PAGE 1 : Lettre de garde ─────────────────────────────────────────────────
async function pageLettreGarde(pdfDoc, fonts, logoImg, infos, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);
  let y = PH - 50;

  // Logo Legato (haut droite)
  if (logoImg) {
    const s = logoImg.scale(0.15);
    page.drawImage(logoImg, {
      x: MR - s.width,
      y: y - s.height + 12,
      width:  s.width,
      height: s.height,
    });
  }

  // Coordonnées Legato (haut gauche)
  page.drawText('Legato SA', { x: ML, y, font: B, size: 10, color: BLACK });
  y -= 13;
  page.drawText('Rue de la Plaine 46', { x: ML, y, font: R, size: 9, color: BLACK });
  y -= 12;
  page.drawText('1400 Yverdon-les-Bains', { x: ML, y, font: R, size: 9, color: BLACK });
  y -= 12;
  page.drawText('024 426 77 00  .  info@legato-eg.ch', { x: ML, y, font: R, size: 9, color: BLACK });

  // Coordonnées entreprise (droite, milieu page)
  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  let ey = PH - 215;
  const ex = 340;
  page.drawText(nomComplet, { x: ex, y: ey, font: B, size: 10, color: BLACK }); ey -= 13;
  if (infos.adresseEntreprise) { page.drawText(infos.adresseEntreprise,  { x: ex, y: ey, font: R, size: 9, color: BLACK }); ey -= 12; }
  if (infos.npVilleEntreprise) { page.drawText(infos.npVilleEntreprise,  { x: ex, y: ey, font: R, size: 9, color: BLACK }); ey -= 12; }

  // Date
  y = PH - 330;
  page.drawText(`Yverdon-les-Bains, le ${dateFr()}`, { x: ML, y, font: R, size: 9, color: BLACK });

  // Objet
  y -= 32;
  page.drawText('Concerne :', { x: ML, y, font: B, size: 9, color: BLACK });
  page.drawText("Votre exemplaire du contrat d'entreprise", { x: ML + 68, y, font: R, size: 9, color: BLACK });

  y -= 17;
  page.drawText(`Projet : ${fd.nomChantier} -- ${fd.adresseProjet}`, { x: ML, y, font: R, size: 9, color: DGRAY });
  y -= 13;
  page.drawText(`CFC ${fd.cfcNumero}  ${fd.cfcLibelle}`, { x: ML, y, font: R, size: 9, color: DGRAY });

  // Corps lettre
  y -= 28;
  page.drawText('Madame, Monsieur,', { x: ML, y, font: R, size: 9, color: BLACK });
  y -= 17;
  y = drawWrapped(page, R,
    "Vous trouverez ci-joint votre contrat d'entreprise en deux exemplaires, les conditions generales de Legato SA ainsi que le devis correspondant. Les instructions relatives a la suite a donner figurent en page suivante.",
    ML, y, 9, BLACK, CW);
  y -= 30;
  page.drawText('Meilleures salutations,', { x: ML, y, font: R, size: 9, color: BLACK });
  y -= 15;
  page.drawText('Legato SA', { x: ML, y, font: B, size: 9, color: BLACK });
}

// ─── PAGE 3 ou 5 : Page 1 du contrat (articles 1 a 5.1) ──────────────────────
async function pageContratRecto(pdfDoc, fonts, infos, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);
  let y = PH - 48;

  // En-tete
  page.drawText('DOCUMENT CONTRACTUEL', { x: ML, y, font: R, size: 7.5, color: GRAY });
  y -= 20;
  page.drawText("Contrat d'entreprise", { x: ML, y, font: B, size: 23, color: GREEN });
  y -= 20;
  page.drawText(fd.nomChantier, { x: ML, y, font: R, size: 10, color: GRAY });
  y -= 13;
  page.drawText(fd.adresseProjet, { x: ML, y, font: R, size: 10, color: GRAY });
  y -= 20;

  // Boites MO / Entrepreneur
  const bY  = y;
  const bH  = 62;
  const bWL = 242;
  const bWR = 235;
  const bXL = ML;
  const bXR = ML + bWL + 14;

  page.drawRectangle({ x: bXL, y: bY - bH, width: bWL, height: bH, borderColor: GRAY, borderWidth: 0.5, color: WHITE });
  page.drawRectangle({ x: bXR, y: bY - bH, width: bWR, height: bH, borderColor: GRAY, borderWidth: 0.5, color: WHITE });

  // MO
  let by = bY - 9;
  page.drawText('MAITRE D\'OUVRAGE', { x: bXL + 7, y: by, font: R, size: 7, color: GRAY }); by -= 13;
  page.drawText('Legato SA',           { x: bXL + 7, y: by, font: B, size: 9, color: BLACK }); by -= 11;
  page.drawText('Rue de la Plaine 46', { x: bXL + 7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10;
  page.drawText('1400 Yverdon-les-Bains', { x: bXL + 7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10;
  page.drawText('024 426 77 00',        { x: bXL + 7, y: by, font: R, size: 8.5, color: BLACK });

  // Entrepreneur
  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  by = bY - 9;
  page.drawText('ENTREPRENEUR', { x: bXR + 7, y: by, font: R, size: 7, color: GRAY }); by -= 13;
  page.drawText(nomComplet,     { x: bXR + 7, y: by, font: B, size: 9, color: BLACK }); by -= 11;
  if (infos.adresseEntreprise)  { page.drawText(infos.adresseEntreprise,  { x: bXR + 7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10; }
  if (infos.npVilleEntreprise)  { page.drawText(infos.npVilleEntreprise,  { x: bXR + 7, y: by, font: R, size: 8.5, color: BLACK }); by -= 10; }
  if (infos.telephoneEntreprise){ page.drawText(infos.telephoneEntreprise, { x: bXR + 7, y: by, font: R, size: 8.5, color: BLACK }); }

  y = bY - bH - 14;

  // CFC et devis
  page.drawText(`CFC ${fd.cfcNumero}  ${fd.cfcLibelle}`, { x: ML, y, font: B, size: 9, color: BLACK }); y -= 12;
  page.drawText(`Selon devis ${infos.noDevis || '...'} du ${infos.dateDevis || '...'}  .  art. 15 al. 3 et 4, norme SIA 118`,
    { x: ML, y, font: R, size: 8.5, color: GRAY }); y -= 17;

  // Recapitulatif financier
  page.drawText('RECAPITULATIF FINANCIER', { x: ML, y, font: B, size: 9, color: BLACK }); y -= 13;

  const lignes = infos.lignesFinancieres || [];
  for (const lg of lignes) {
    const f = lg.bold ? B : R;
    page.drawText(lg.label, { x: ML, y, font: f, size: 9, color: BLACK });
    const mTxt = `CHF    ${lg.montant}`;
    const mW   = f.widthOfTextAtSize(mTxt, 9);
    page.drawText(mTxt, { x: MR - mW, y, font: f, size: 9, color: BLACK });
    y -= 12;
  }
  y -= 8;

  // Ligne separatrice
  page.drawLine({ start: { x: ML, y }, end: { x: MR, y }, thickness: 0.3, color: GRAY });
  y -= 14;

  // ARTICLE 1 ─────────────────────────────────────────────────────────────────
  page.drawText('1  OBJET DU CONTRAT', { x: ML, y, font: B, size: 9.5, color: BLACK }); y -= 13;
  y = drawWrapped(page, R,
    "Le Maitre d'ouvrage est une entreprise generale construisant des villas ou autres batiments cles en main. Il entend confier a l'entrepreneur les travaux precites.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 7;

  // ARTICLE 2 ─────────────────────────────────────────────────────────────────
  page.drawText('2  PRIX', { x: ML, y, font: B, size: 9.5, color: BLACK }); y -= 13;
  y = drawWrapped(page, R,
    "Les plus et/ou moins-values seront precisees de cas en cas par commande ecrite du Maitre d'ouvrage.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 5;
  y = drawWrapped(page, R,
    "Le Maitre d'ouvrage pourra refuser le paiement de tous travaux qu'il n'aurait pas expressement commandes ou dont le prix n'aurait pas ete expressement accepte par lui avant leur execution.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 7;

  // ARTICLE 3 ─────────────────────────────────────────────────────────────────
  page.drawText('3  DELAIS', { x: ML, y, font: B, size: 9.5, color: BLACK }); y -= 13;
  y = drawWrapped(page, R,
    "Avant le debut de la construction, le Maitre d'ouvrage remet a l'entrepreneur un planning indiquant la periode pendant laquelle il doit realiser les travaux qui lui incombent et un delai d'execution.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 5;
  y = drawWrapped(page, R,
    "L'entrepreneur s'engage a realiser les travaux pendant cette periode et ce delai. Il ne peut en aucun cas invoquer un manque ou l'absence de personnel pour retarder l'execution des travaux. En revanche, Legato SA s'engage a faire les choix et details dans des delais acceptables.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 5;
  y = drawWrapped(page, R,
    "L'entrepreneur s'engage a suivre les ordres et instructions du Maitre d'ouvrage, seul habilite a planifier et coordonner la construction de l'ouvrage. Il a l'obligation d'assister aux reunions de chantier, sur convocation du Maitre d'ouvrage.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 5;
  y = drawWrapped(page, R,
    "Pour le surplus, l'art. 92 de la norme SIA 118 est applicable.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 7;

  // ARTICLE 4 ─────────────────────────────────────────────────────────────────
  page.drawText("4  ASSURANCE DE L'ENTREPRISE -- ART. 26 AL. 1 SIA 118", { x: ML, y, font: B, size: 9.5, color: BLACK }); y -= 13;
  y = drawWrapped(page, R,
    "L'entrepreneur declare etre couvert pour les dommages causes aux personnes ou aux biens par une assurance responsabilite civile a l'egard des tiers.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 5;
  page.drawText('Compagnie et n\u00b0 : ......................................................', { x: ML + 8, y, font: R, size: 9, color: BLACK }); y -= 12;
  page.drawText('Prestation max. par dommage : ..................................', { x: ML + 8, y, font: R, size: 9, color: BLACK }); y -= 17;

  // ARTICLE 5 (debut) ─────────────────────────────────────────────────────────
  page.drawText('5  CONDITIONS', { x: ML, y, font: B, size: 9.5, color: BLACK }); y -= 13;
  y = drawWrapped(page, R,
    "5.1 Conditions de paiement -- art. 144 SIA 118 : 90% sur situations suivant l'avancement des travaux ; 10% a la fin des travaux (receptionnes par le Maitre d'ouvrage), contre remise d'une garantie bancaire ou d'assurance, et apres versement du solde du contrat d'entreprise generale.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 5;

  // Debut 5.2 (coupure de page comme dans le modele)
  y = drawWrapped(page, R,
    "5.2 Les Conditions generales pour un contrat d'entreprise de Legato SA font partie integrante du present contrat. En cas de",
    ML + 8, y, 9, BLACK, CW - 8);
}

// ─── PAGE 4 ou 6 : Page 2 du contrat (suite 5.2, articles 6 et 7, signatures) ─
async function pageContratVerso(pdfDoc, fonts, infos, fd) {
  const { R, B } = fonts;
  const page = pdfDoc.addPage([PW, PH]);
  let y = PH - 55;

  // Suite article 5.2
  y = drawWrapped(page, R,
    "contradiction, l'ordre de priorite s'etablit selon l'art. 21 al. 1 SIA 118 ; dans le cas d'une contre-offre, selon l'art. 22 al. 4.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 7;

  // ARTICLE 6 ─────────────────────────────────────────────────────────────────
  page.drawText('6  GARANTIES', { x: ML, y, font: B, size: 9.5, color: BLACK }); y -= 13;
  y = drawWrapped(page, R,
    "Les garanties donnees par l'entrepreneur sur les travaux effectues contre les defauts apparents et caches sont conformes a celles prevues par la norme SIA 118, sans restriction.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 5;
  y = drawWrapped(page, R,
    "Le Maitre d'ouvrage est en droit de reclamer a l'entrepreneur le remboursement integral de toute indemnite qu'il devrait verser au proprietaire a la suite d'une faute ou negligence commise par l'entrepreneur.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 7;

  // ARTICLE 7 ─────────────────────────────────────────────────────────────────
  page.drawText('7  FOR -- ART. 37 SIA 118', { x: ML, y, font: B, size: 9.5, color: BLACK }); y -= 13;
  y = drawWrapped(page, R,
    "Les parties conviennent qu'en cas de contestation, le for sera au lieu de situation de l'ouvrage. Le present contrat, etabli en deux exemplaires, engage reciproquement, par leur signature, l'entrepreneur et le Maitre d'ouvrage.",
    ML + 8, y, 9, BLACK, CW - 8); y -= 25;

  // Date et lieu
  page.drawText(`Lieu et date : Yverdon-les-Bains, le ${dateFr()}`, { x: ML, y, font: R, size: 9, color: BLACK }); y -= 35;

  // Signatures
  const nomComplet = `${fd.nomEntreprise} ${fd.formeJuridique}`;
  const sxR = MR - 200;
  page.drawText('LE MAITRE D\'OUVRAGE', { x: ML,  y, font: B, size: 8.5, color: BLACK });
  page.drawText('L\'ENTREPRENEUR',       { x: sxR, y, font: B, size: 8.5, color: BLACK }); y -= 13;
  page.drawText('Legato SA',             { x: ML,  y, font: R, size: 9, color: BLACK });
  page.drawText(nomComplet,              { x: sxR, y, font: R, size: 9, color: BLACK }); y -= 32;
  page.drawText('Signature : ................................', { x: ML,  y, font: R, size: 9, color: BLACK });
  page.drawText('Signature : ................................', { x: sxR, y, font: R, size: 9, color: BLACK });
}

// ─── HANDLER PRINCIPAL ───────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Methode non autorisee');
    return;
  }

  try {
    // 1. Parser le formulaire multipart
    const { fields, files } = await parseForm(req);

    // 2. Valider les champs obligatoires
    const reqFields = ['nomChantier','adresseProjet','cfcNumero','cfcLibelle','nomEntreprise','formeJuridique'];
    for (const f of reqFields) {
      if (!fields[f] || !fields[f].toString().trim()) {
        res.status(400).json({ error: `Champ manquant : ${f}` });
        return;
      }
    }

    const fd = {
      nomChantier:   fields.nomChantier.toString().trim(),
      adresseProjet: fields.adresseProjet.toString().trim(),
      cfcNumero:     fields.cfcNumero.toString().trim(),
      cfcLibelle:    fields.cfcLibelle.toString().trim(),
      nomEntreprise: fields.nomEntreprise.toString().trim(),
      formeJuridique:fields.formeJuridique.toString().trim(),
    };

    const devisBuffer = files.devis;
    if (!devisBuffer || devisBuffer.length === 0) {
      res.status(400).json({ error: 'Devis PDF manquant' });
      return;
    }

    // 3. Extraire les infos du devis via Claude
    const infos = await extraireInfosDevis(devisBuffer);

    // 4. Lire les assets
    const assetsDir = path.join(__dirname, '..', 'assets');
    const logoPath  = path.join(assetsDir, 'logo_legato.png');
    const fichePath = path.join(assetsDir, 'fiche_attestations.pdf');
    const cgPath    = path.join(assetsDir, 'conditions_generales.pdf');

    const ficheBytes = fs.readFileSync(fichePath);
    const cgBytes    = fs.readFileSync(cgPath);
    const logoBytes  = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;

    // 5. Creer le document PDF
    const pdfDoc = await PDFDocument.create();
    const B = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const R = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fonts = { B, R };

    let logoImg = null;
    if (logoBytes) {
      try { logoImg = await pdfDoc.embedPng(logoBytes); } catch (_) { logoImg = null; }
    }

    // PAGE 1 : Lettre de garde
    await pageLettreGarde(pdfDoc, fonts, logoImg, infos, fd);

    // PAGE 2 : Fiche attestations (asset PDF)
    const fichePdf  = await PDFDocument.load(ficheBytes);
    const fichePages = await pdfDoc.copyPages(fichePdf, fichePdf.getPageIndices());
    fichePages.forEach(p => pdfDoc.addPage(p));

    // PAGES 3-4 : Contrat exemplaire 1
    await pageContratRecto(pdfDoc, fonts, infos, fd);
    await pageContratVerso(pdfDoc, fonts, infos, fd);

    // PAGES 5-6 : Contrat exemplaire 2
    await pageContratRecto(pdfDoc, fonts, infos, fd);
    await pageContratVerso(pdfDoc, fonts, infos, fd);

    // PAGES 7-18 : Conditions generales (asset PDF)
    const cgPdf   = await PDFDocument.load(cgBytes);
    const cgPages = await pdfDoc.copyPages(cgPdf, cgPdf.getPageIndices());
    cgPages.forEach(p => pdfDoc.addPage(p));

    // PAGES 19+ : Devis x2
    const devisPdf = await PDFDocument.load(devisBuffer);
    const devisIdx = devisPdf.getPageIndices();

    const dv1 = await pdfDoc.copyPages(devisPdf, devisIdx);
    dv1.forEach(p => pdfDoc.addPage(p));

    const dv2 = await pdfDoc.copyPages(devisPdf, devisIdx);
    dv2.forEach(p => pdfDoc.addPage(p));

    // 6. Serialiser
    const pdfBytes = await pdfDoc.save();

    const nomFichier = `Contrat_${fd.nomEntreprise.replace(/\s+/g, '_')}_CFC${fd.cfcNumero}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${nomFichier}"`);
    res.status(200).send(Buffer.from(pdfBytes));

  } catch (err) {
    console.error('ERREUR generer.js:', err);
    res.status(500).json({ error: 'Erreur lors de la generation', detail: err.message });
  }
};
