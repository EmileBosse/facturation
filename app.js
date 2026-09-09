/* ============================================================
   FactureFlash — logique de l'application
   Structure du fichier :
     1. L'état (les données)
     2. Le rendu (afficher l'état à l'écran)
     3. Les événements (réagir à l'utilisateur)
     4. Les exports (PDF / JPEG)
     5. La sauvegarde locale + le service worker
   ============================================================ */

// -----------------------------------------------------------
// 1. L'ÉTAT
// Un seul objet contient TOUTES les données de la facture.
// Règle d'or : on modifie l'état, puis on appelle rendre().
// -----------------------------------------------------------
let facture = {
  emetteurNom: '',
  emetteurInfos: '',
  clientNom: '',
  clientInfos: '',
  numero: 'F-0001',
  date: new Date().toISOString().slice(0, 10), // format AAAA-MM-JJ
  tps: 5,
  tvq: 9.975,
  notes: '',
  lignes: [
    { description: '', quantite: 1, prix: 0 }
  ]
};

// Petit raccourci pour document.querySelector
const $ = (sel) => document.querySelector(sel);

// Formate un nombre en devise canadienne-française : 1 234,56 $
const argent = (n) =>
  new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);


// -----------------------------------------------------------
// 2. LE RENDU
// -----------------------------------------------------------

/** Calcule les totaux à partir de l'état. Fonction pure : elle ne modifie rien. */
function calculer() {
  const sousTotal = facture.lignes.reduce(
    (somme, l) => somme + (Number(l.quantite) || 0) * (Number(l.prix) || 0),
    0
  );
  const mtTps = sousTotal * (Number(facture.tps) || 0) / 100;
  const mtTvq = sousTotal * (Number(facture.tvq) || 0) / 100;
  return { sousTotal, mtTps, mtTvq, total: sousTotal + mtTps + mtTvq };
}

/** Redessine les champs de lignes dans le formulaire. */
function rendreFormulaireLignes() {
  const conteneur = $('#lignes');
  conteneur.innerHTML = ''; // on vide, puis on reconstruit

  facture.lignes.forEach((ligne, index) => {
    const div = document.createElement('div');
    div.className = 'ligne';
    div.innerHTML = `
      <input type="text"   placeholder="Description" data-ligne="${index}" data-prop="description">
      <input type="number" placeholder="Qté"  step="0.01" data-ligne="${index}" data-prop="quantite">
      <input type="number" placeholder="Prix" step="0.01" data-ligne="${index}" data-prop="prix">
      <button class="supprimer" type="button" data-supprimer="${index}" title="Supprimer">&times;</button>
    `;
    // On assigne les valeurs en JS (et non dans le HTML) pour éviter
    // tout problème de caractères spéciaux dans le texte saisi.
    div.querySelector('[data-prop="description"]').value = ligne.description;
    div.querySelector('[data-prop="quantite"]').value = ligne.quantite;
    div.querySelector('[data-prop="prix"]').value = ligne.prix;

    conteneur.appendChild(div);
  });
}

/** Met à jour l'aperçu de la facture (colonne de droite). */
function rendreApercu() {
  const t = calculer();

  $('#p-numero').textContent = facture.numero || '—';
  $('#p-date').textContent = facture.date
    ? new Date(facture.date + 'T00:00:00').toLocaleDateString('fr-CA')
    : '—';

  $('#p-emetteurNom').textContent = facture.emetteurNom || '—';
  $('#p-emetteurInfos').textContent = facture.emetteurInfos;
  $('#p-clientNom').textContent = facture.clientNom || '—';
  $('#p-clientInfos').textContent = facture.clientInfos;

  // Les lignes du tableau
  $('#p-lignes').innerHTML = facture.lignes
    .map((l) => {
      const total = (Number(l.quantite) || 0) * (Number(l.prix) || 0);
      const desc = (l.description || '—')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;'); // sécurité : on neutralise le HTML
      return `<tr>
        <td>${desc}</td>
        <td class="num">${Number(l.quantite) || 0}</td>
        <td class="num">${argent(l.prix)}</td>
        <td class="num">${argent(total)}</td>
      </tr>`;
    })
    .join('');

  $('#p-labelTps').textContent = `TPS (${facture.tps || 0} %)`;
  $('#p-labelTvq').textContent = `TVQ (${facture.tvq || 0} %)`;
  $('#p-sousTotal').textContent = argent(t.sousTotal);
  $('#p-mtTps').textContent = argent(t.mtTps);
  $('#p-mtTvq').textContent = argent(t.mtTvq);
  $('#p-total').textContent = argent(t.total);
  $('#p-notes').textContent = facture.notes;
}

/** Rendu complet + sauvegarde. */
function rendre() {
  rendreApercu();
  sauvegarder();
}


// -----------------------------------------------------------
// 3. LES ÉVÉNEMENTS
// -----------------------------------------------------------

// Champs simples : tout élément avec data-field="clé"
document.querySelectorAll('[data-field]').forEach((el) => {
  el.addEventListener('input', () => {
    facture[el.dataset.field] = el.value;
    rendre();
  });
});

// Champs de lignes : on écoute le conteneur (délégation d'événements).
// Avantage : ça marche aussi pour les lignes créées plus tard.
$('#lignes').addEventListener('input', (e) => {
  const index = e.target.dataset.ligne;
  if (index === undefined) return;
  facture.lignes[index][e.target.dataset.prop] = e.target.value;
  rendre();
});

$('#lignes').addEventListener('click', (e) => {
  const index = e.target.dataset.supprimer;
  if (index === undefined) return;
  facture.lignes.splice(index, 1);            // retire la ligne
  if (facture.lignes.length === 0) ajouterLigne(false);
  rendreFormulaireLignes();
  rendre();
});

function ajouterLigne(redessiner = true) {
  facture.lignes.push({ description: '', quantite: 1, prix: 0 });
  if (redessiner) { rendreFormulaireLignes(); rendre(); }
}

$('#btn-ajouter').addEventListener('click', () => ajouterLigne());

$('#btn-reset').addEventListener('click', () => {
  if (!confirm('Effacer la facture en cours ?')) return;
  localStorage.removeItem('factureflash');
  location.reload();
});


// -----------------------------------------------------------
// 4. LES EXPORTS
// Principe : html2canvas « photographie » le bloc #facture
// et nous rend un <canvas>. Ensuite :
//   - JPEG : on télécharge directement l'image du canvas
//   - PDF  : on colle cette image dans une page A4 avec jsPDF
// -----------------------------------------------------------

function nomFichier(extension) {
  const nom = (facture.numero || 'facture').replace(/[^\w-]/g, '_');
  return `${nom}.${extension}`;
}

/** Transforme #facture en canvas haute résolution. */
async function capturer() {
  return html2canvas($('#facture'), {
    scale: 2,             // x2 = rendu net (rétine / impression)
    backgroundColor: '#ffffff',
    useCORS: true
  });
}

/** Déclenche le téléchargement d'une URL de données. */
function telecharger(url, nom) {
  const a = document.createElement('a');
  a.href = url;
  a.download = nom;
  a.click();
}

$('#btn-jpeg').addEventListener('click', async () => {
  const canvas = await capturer();
  telecharger(canvas.toDataURL('image/jpeg', 0.95), nomFichier('jpg'));
});

$('#btn-pdf').addEventListener('click', async () => {
  const canvas = await capturer();
  const image = canvas.toDataURL('image/jpeg', 0.95);

  // jsPDF est exposé dans window.jspdf par la version UMD
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });

  const largeurPage = 210;
  // On garde les proportions de l'image capturée
  const hauteurImage = (canvas.height / canvas.width) * largeurPage;

  pdf.addImage(image, 'JPEG', 0, 0, largeurPage, hauteurImage);
  pdf.save(nomFichier('pdf'));
});


// -----------------------------------------------------------
// 5. SAUVEGARDE LOCALE + SERVICE WORKER
// -----------------------------------------------------------

/** localStorage ne stocke que du texte : on sérialise en JSON. */
function sauvegarder() {
  localStorage.setItem('factureflash', JSON.stringify(facture));
}

function charger() {
  const brut = localStorage.getItem('factureflash');
  if (!brut) return;
  try {
    facture = { ...facture, ...JSON.parse(brut) };
  } catch (e) {
    console.warn('Sauvegarde illisible, on repart à neuf.', e);
  }
}

/** Remplit les champs du formulaire avec l'état chargé. */
function remplirFormulaire() {
  document.querySelectorAll('[data-field]').forEach((el) => {
    el.value = facture[el.dataset.field] ?? '';
  });
}

// Démarrage
charger();
remplirFormulaire();
rendreFormulaireLignes();
rendre();

// Le service worker rend l'app installable et utilisable hors-ligne.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .catch((err) => console.warn('Service worker non enregistré :', err));
  });
}
