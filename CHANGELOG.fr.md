# Journal des modifications

Ce qui change pour vous, version par version. Gladys relie le numéro de
version d'une intégration installée aux releases de ce dépôt : chaque entrée
ci-dessous est aussi le corps de la release GitHub correspondante — le
workflow de release la publie à partir de la section de la version qu'il
publie, qu'il faut donc écrire avant de le lancer.

_English version: [CHANGELOG.md](./CHANGELOG.md)._

## 1.1.0

**Nécessite Gladys 5.1.0 ou plus récent**, la version qui apporte les cartes
de tableau de bord aux intégrations externes. Sur un Gladys plus ancien, la
mise à jour n'est tout simplement pas proposée et la 1.0.2 continue de
fonctionner. Rien à reconfigurer, aucun appareil à recréer : vos appareils,
leur historique et vos réglages ne sont pas touchés.

### Deux cartes pour vos tableaux de bord

À ajouter depuis le sélecteur de blocs de n'importe quel tableau de bord.

**Arrosage GARDENA**

- une ligne par sortie d'eau et pour la prise d'extérieur, en clair — et une
  pompe de surpression est désormais dite en marche ou à l'arrêt, là où
  GARDENA la rapporte comme une vanne et où elle se lisait « fermée » ;
- une tuile d'humidité du sol par capteur, qui suivent les valeurs en direct ;
- la **courbe de l'humidité du sol sur la semaine écoulée**, tracée à partir
  de l'historique que Gladys conserve déjà : ce qui dit que le sol se dessèche,
  là où un chiffre ne dit que l'instant ;
- **Arrêter l'arrosage**, qui ferme toutes les vannes du compte d'un coup ;
- **Arroser…**, pour ouvrir une sortie pendant une durée choisie ;
- un bouton pour allumer ou éteindre la prise, dont le libellé suit son état.

**Tondeuse GARDENA**

- activité, état et dernière erreur, en clair ;
- jauge de batterie et heures de tonte ;
- **Tondre** ou **Rentrer**, selon ce que la tondeuse est en train de faire ;
- **Tondre…**, pour une durée ponctuelle ;
- **Garer, sans calendrier**, qui demande une confirmation puisqu'il annule le
  calendrier de la tondeuse jusqu'à ce que vous la relanciez.

**Afficher une carte ne coûte rien à votre quota hebdomadaire GARDENA.** Les
cartes se contentent de l'image que le flux temps réel garde en mémoire ; seul
un appui sur un bouton d'action envoie une requête, une par commande.

Chaque carte a un réglage optionnel — quel capteur elle met en avant, quelle
tondeuse ses boutons pilotent — pour les jardins qui en ont plusieurs.
Laissez-le vide sinon.

Une chose à savoir sur la courbe : avec plusieurs capteurs, la légende répète
« Soil humidity », parce que Gladys nomme les séries d'un graphique d'après la
fonctionnalité lue et non d'après l'appareil. Ce qui distingue les courbes est
leur forme. Fixez un capteur dans les réglages de la carte pour n'avoir qu'une
courbe, nommée d'après lui dans le titre, ou posez une carte par zone.

### Corrigé

- La relecture périodique derrière le flux temps réel — le filet de sécurité
  pour un message manqué par le websocket — n'était en réalité jamais armée.
  Les appareils créés à partir de cette version en bénéficient. Les appareils
  déjà créés ne changent pas et continuent de vivre sur le flux temps réel,
  qui resynchronise tout le jardin à chaque reconnexion ; les recréer pour le
  seul filet de sécurité coûterait leur historique, ce qui n'en vaut pas la
  peine.

## 1.0.2

- Catégories de catalogue (Électroménager, Environnement), pour que
  l'intégration apparaisse dans les filtres du catalogue de Gladys 4.86.

## 1.0.1

Première version publiée sur le store.

- Tondeuses, vannes d'arrosage, sorties d'Irrigation Control, prises
  d'extérieur et capteurs de sol, pilotés via l'API publique officielle
  GARDENA smart system ;
- temps réel d'abord : un websocket par emplacement porte chaque changement,
  qu'il vienne de l'appareil, de l'application GARDENA ou d'un programme ;
- construit autour du **quota hebdomadaire de requêtes** d'une application
  GARDENA gratuite : les relectures sont partagées entre tous les appareils,
  espacées, et suspendues une heure si GARDENA répond « trop de requêtes » ;
- humidité du sol publiée en décimal, ce que Gladys sait afficher ;
- le logo GARDENA en couverture dans le catalogue.
