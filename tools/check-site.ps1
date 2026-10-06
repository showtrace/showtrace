# Checks what a machine can check of the Showtrace website before it is published.
#   1. Files: the pages the site is made of exist.
#   2. Typography: no em dash, en dash, curly quote, arrow or ellipsis in any text file, as a character or as an
#      HTML entity. Keyboard characters only.
#   3. Words: none of the words the brand guide avoids is in a page, the old prototype name included, and
#      "for Windows" stands only in a download button.
#   4. Self-contained: no script, no event handler, and no stylesheet, font or image from another domain.
#      The page works without JavaScript and carries no tracker.
# The rules come from the brand guide and the session contract of the Showtrace repository (brand.md, AGENTS.md).
# The workflow runs this script before every deployment; a failure stops the deployment. The script is plain
# ASCII: Windows PowerShell 5.1 reads a script without a byte-order mark as ANSI, and the file must pass its own check.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\check-site.ps1      (Windows PowerShell 5.1 or PowerShell 7)
$root = Split-Path $PSScriptRoot -Parent
$problems = New-Object System.Collections.Generic.List[string]

# 1. Files.
$required = @('site/index.html', 'site/styles.css', 'site/logo.svg', 'site/favicon.svg', 'site/images')
foreach ($item in $required) {
    if (-not (Test-Path (Join-Path $root $item))) { $problems.Add("$item is missing") }
}
"Files: $($required.Count) required paths looked for."

# The files to read: tracked and untracked, without the ignored ones, and without pictures and fonts.
$files = @(& git -C $root -c core.quotepath=off ls-files --cached --others --exclude-standard | Where-Object { $_ -notmatch '\.(png|jpg|jpeg|gif|ico|webp|woff2?|pdf)$' })
if ($files.Count -eq 0) { Write-Error "No files found in $root."; exit 2 }
$pages = @($files | Where-Object { $_ -match '\.html$' })
$sheets = @($files | Where-Object { $_ -match '\.css$' })

# 2. Typography. The characters are built from their code points, so that this file stays plain ASCII.
$typography = '[' + (-join ((0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2190, 0x2192, 0x21D2, 0x2026) | ForEach-Object { [char]$_ })) + ']'
$names = @{ 0x2013 = 'en dash'; 0x2014 = 'em dash'; 0x2018 = 'curly quote'; 0x2019 = 'curly quote'; 0x201C = 'curly quote'; 0x201D = 'curly quote'; 0x2190 = 'arrow'; 0x2192 = 'arrow'; 0x21D2 = 'arrow'; 0x2026 = 'ellipsis' }
$entities = '&(mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|larr|rarr|rArr);|&#(8211|8212|8216|8217|8220|8221|8230|8592|8594|8658);|&#x(201[34]|201[89]|201[CDcd]|2026|2190|2192|21[Dd]2);'
foreach ($file in $files) {
    $number = 0
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $root $file))) {
        $number++
        foreach ($match in [regex]::Matches($line, $typography)) {
            $code = [int][char]$match.Value
            $problems.Add("${file}:${number}: $($names[$code]) (U+$('{0:X4}' -f $code)); keyboard characters only")
        }
        if ($file -match '\.html$' -and $line -match $entities) { $problems.Add("${file}:${number}: the entity '$($Matches[0])' stands for a dash, a curly quote, an arrow or an ellipsis; keyboard characters only") }
    }
}
"Typography: $($files.Count) files read for em dashes, en dashes, curly quotes, arrows and ellipses."

# 3. Words. Whole words, without regard to case, in the pages. The list is brand.md, section 5, "Words we avoid",
# plus the old prototype name and the word the brand does not use for marks.
$avoid = @('AI-powered', 'intelligent', 'smart', 'seamless', 'effortless', 'powerful', 'revolutionary', 'unlock', 'empower', 'boost', 'leverage', 'next-generation', 'cutting-edge', 'unique', 'the first', 'monitoring', 'tracking', 'surveillance', 'annotation', 'annotations', 'annotate', 'Marker')
foreach ($file in $pages) {
    $number = 0
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $root $file))) {
        $number++
        foreach ($word in $avoid) {
            if ($line -match ('\b' + [regex]::Escape($word) + '\b')) { $problems.Add("${file}:${number}: '$word' is a word the brand guide avoids (brand.md, section 5)") }
        }
        if ($line -match 'for Windows' -and $line -notmatch 'class="[^"]*\bdownload-button\b') { $problems.Add("${file}:${number}: 'for Windows' stands outside a download button (brand.md, section 2)") }
    }
}
"Words: $($pages.Count) pages read for the $($avoid.Count) words the brand guide avoids and for 'for Windows'."

# 4. Self-contained.
$external = '<(link|img|source|iframe|video|audio|object|embed|script)\b[^>]*\b(src|href)\s*=\s*"\s*(https?:)?//'
foreach ($file in $pages) {
    $number = 0
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $root $file))) {
        $number++
        if ($line -match '<script') { $problems.Add("${file}:${number}: a script; the page works without JavaScript") }
        if ($line -match '\son[a-z]+\s*=\s*"') { $problems.Add("${file}:${number}: an event handler attribute; the page has no JavaScript") }
        if ($line -match '<(iframe|object|embed)\b') { $problems.Add("${file}:${number}: an embedded document; the page carries no tracker") }
        if ($line -match $external) { $problems.Add("${file}:${number}: a resource from another domain; everything is served from this site") }
    }
}
foreach ($file in $sheets) {
    $number = 0
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $root $file))) {
        $number++
        if ($line -match '@import|url\(\s*["'']?\s*(https?:)?//') { $problems.Add("${file}:${number}: a stylesheet, font or image from another domain; everything is served from this site") }
    }
}
"Self-contained: $($pages.Count) pages and $($sheets.Count) stylesheets read for scripts, event handlers, embedded documents and resources from other domains."

if ($problems.Count -gt 0) {
    ''
    $problems | ForEach-Object { "FAIL: $_" }
    "$($problems.Count) problem(s)"
    exit 1
}
'PASS: the site checks found nothing.'
exit 0
