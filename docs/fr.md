# Meteobridge

Intégration non officielle, sans lien avec smartbedded (Meteobridge).

Elle lit la station météo branchée sur votre passerelle **Meteobridge** (NANO SD,
PRO, PRO2, NANO, ou la version logicielle : Davis, Ecowitt, Fine Offset,
WeatherFlow et les autres stations qu'elle prend en charge) directement sur
votre réseau local, sans le cloud.

**Cette intégration n'a jamais été testée avec un vrai Meteobridge** : elle a
été écrite d'après le wiki officiel de Meteobridge (pages « Add-On Services » et
« Templates »). Les retours sont les bienvenus sur le dépôt GitHub.

## Ce que vous obtenez

Un appareil Gladys par passerelle (repérée par son adresse MAC), avec une
fonctionnalité pour chaque valeur que la passerelle a donnée au moins une fois :

- température, humidité et point de rosée extérieurs ; refroidissement éolien ;
- température et humidité intérieures (console) ;
- pression au niveau de la mer et à la station (hPa) ;
- vitesse moyenne du vent et rafale (km/h), direction du vent (degrés) ;
- intensité de pluie (mm/h) et pluie du jour depuis minuit (mm, heure de la passerelle) ;
- indice UV, rayonnement solaire (affiché en lux : 1 W/m² ≈ 126,6 lx, le cœur n'a
  pas d'unité W/m²) ;
- PM2.5 (µg/m³) ;
- les capteurs supplémentaires de température et d'humidité 1 à 8 ;
- les piles faibles (capteur extérieur, anémomètre, pluviomètre, console).

Les stations sol et feuilles Davis ne sont pas lues dans cette version.

## Configuration

1. Dans l'interface web de votre Meteobridge, notez son adresse IP. Donnez-lui
   une adresse fixe dans votre box.
2. Dans Gladys, ouvrez l'intégration et saisissez :
   - l'**adresse** (par exemple `192.168.1.50`, ou `192.168.1.50:8080` si
     l'interface web n'est pas sur le port 80) ;
   - le **nom d'utilisateur** et le **mot de passe** de l'interface web du
     Meteobridge (le nom d'utilisateur est souvent `meteobridge`) ;
   - l'**intervalle de lecture** en minutes (1 par défaut, de 1 à 60).
3. Cliquez sur **Tester le Meteobridge**, puis ajoutez l'appareil depuis
   l'onglet Découverte.

## Fonctionnement

À chaque intervalle, l'intégration envoie **une** requête à la page de gabarits
de la passerelle (`/cgi-bin/template.cgi`), avec un gabarit qui demande la
valeur actuelle de chaque capteur. Rien ne lit plus tôt que l'intervalle : ni le
bouton de test, ni un redémarrage, ni une reconnexion (l'heure de la dernière
requête est gardée dans `/data`, écrite avant chaque requête). Seule exception :
de nouveaux identifiants ou une nouvelle adresse, enregistrés dans la
configuration, sont essayés dans les 15 secondes.

- Un capteur que la passerelle n'a pas entendu depuis son délai de maintien est
  écrit `--` par la passerelle : la valeur reste inconnue dans Gladys, elle
  n'est jamais publiée comme 0. Un texte, une valeur vide ou hors bornes est
  écarté aussi.
- La pluie du jour n'est publiée que tant que le pluviomètre lui-même est à jour.
- Une mesure est publiée pendant deux intervalles (5 minutes au moins, 2 heures
  au plus) ; au-delà, rien d'ancien n'est renvoyé.
- Une autre passerelle qui répond à la même adresse (autre adresse MAC) devient
  son propre appareil ; les valeurs de la première ne lui sont jamais données.

## Mot de passe et sécurité

Le mot de passe est gardé par Gladys dans sa base et jamais réaffiché. Il est
envoyé seulement au Meteobridge, dans l'authentification HTTP Basic de chaque
requête. La passerelle parle en HTTP simple : sur votre réseau local, le mot de
passe circule comme lorsque vous ouvrez l'interface web dans votre navigateur.
N'exposez jamais la passerelle sur Internet. Le mot de passe n'est jamais écrit
dans un journal, un statut ni dans `/data` ; une redirection n'est jamais suivie.

Si la passerelle refuse le nom d'utilisateur ou le mot de passe (HTTP 401),
l'intégration s'arrête : elle ne les renvoie jamais d'elle-même. Corrigez-les et
enregistrez (ils sont alors essayés dans les 15 secondes), ou cliquez sur
**Tester le Meteobridge** (un essai par intervalle). Après un redémarrage,
`/data` ne garde que 8 bits d'une empreinte salée des identifiants refusés,
assez pour ne pas renvoyer les mêmes ; avec 1 chance sur 256, de nouveaux
identifiants tombent sur ces 8 bits et attendent un clic sur Tester. Un 403
n'est pas un refus du mot de passe (quelque chose s'interpose entre Gladys et la
passerelle) : les lectures continuent.

Une passerelle occupée (HTTP 429 ou 5xx) obtient une pause : le délai qu'elle
demande (`Retry-After`), sinon 1 minute doublée à chaque fois, 30 minutes au
plus, gardée après un redémarrage.

## Lecture seule

L'intégration ne modifie jamais rien sur la passerelle : elle lit une page, avec
la seule méthode GET.

## Sources

La syntaxe des gabarits, les noms des capteurs et les unités sont ceux du wiki
officiel de Meteobridge : https://www.meteobridge.com/wiki/index.php/Templates et
https://www.meteobridge.com/wiki/index.php/Add-On_Services. Aucun code n'a été copié.
