<?php
/**
 * Website-spezifische Einstellungen des LumioWeb Mini-CMS.
 * Bei einem neuen Kundenprojekt nur diese Datei anpassen.
 */
return [
    // Name der Website (wird in der Verwaltung angezeigt)
    'site_name' => 'AlpenGlanz Hausservice',

    // Reihenfolge + Beschriftung der Seiten in der Verwaltung.
    // Seiten, die hier nicht stehen, werden automatisch erkannt
    // und alphabetisch angehängt.
    'page_labels' => [
        'index.html'       => 'Startseite',
        'leistungen.html'  => 'Leistungen',
        'ueber-uns.html'   => 'Über uns',
        'kontakt.html'     => 'Kontakt',
        'impressum.html'   => 'Impressum',
        'datenschutz.html' => 'Datenschutz',
        'en/index.html'    => 'Startseite (Englisch)',
        'en/services.html' => 'Leistungen (Englisch)',
        'en/about.html'    => 'Über uns (Englisch)',
        'en/contact.html'  => 'Kontakt (Englisch)',
    ],
];
