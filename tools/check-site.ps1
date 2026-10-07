# Checks what a machine can check of the Showtrace website before it is published.
#   1. Files: the pages (the front page and the 404 page), the stylesheet, the script, the logo, the favicon and the
#      self-hosted font exist.
#   2. Typography: no em dash, en dash, curly quote, arrow or ellipsis in any text file, as a character or as an
#      HTML entity. Keyboard characters only.
#   3. Words: none of the words the brand guide avoids is in a page or in the script, the old prototype name
#      included, and "for Windows" stands only in a download button.
#   4. Scripts and the policy: the one script is the site's own file, loaded by its one line; no inline script or
#      style element, no event handler or style attribute, no javascript: address. Every page carries a content
#      security policy before anything it loads, and the policy is as strict as the site's: default-src, base-uri
#      and form-action 'none', every source 'self' or 'none', and script-src 'none' on a page without the script.
#   5. Script content: nothing leaves the browser and nothing is stored. The script makes no request (fetch,
#      XMLHttpRequest, sendBeacon, WebSocket, EventSource, a service worker), uses no storage (localStorage,
#      sessionStorage, indexedDB, cookies), loads no module and evaluates no code.
#   6. Addresses and resources: nothing is loaded from another domain, by a page, an SVG file or the stylesheet; no
#      embedded document, no form, no ping, no refresh. A link to another site loads nothing until it is followed, so
#      an <a> may name one. The canonical link and the sharing tags name an address and load nothing; they may name
#      only the site's own public address.
#   7. Local references: every file a page, an SVG file or the stylesheet names exists, in the case it is named in
#      (GitHub Pages is case-sensitive); a path from the root starts with the path of the public address, as the 404
#      page's paths do; every in-page link and every id reference names an id on its page, and no id is used twice.
# The rules come from the brand guide, the session contract and the decisions of 2026-10-06 in the Showtrace
# repository (brand.md, AGENTS.md, company/DECISIONS.md). The workflow runs this script before every deployment;
# a failure stops the deployment. The script is plain ASCII: Windows PowerShell 5.1 reads a script without a
# byte-order mark as ANSI, and the file must pass its own check.
# Usage:  powershell -ExecutionPolicy Bypass -File tools\check-site.ps1      (Windows PowerShell 5.1 or PowerShell 7)
param(
    # The public address of the site. GitHub Pages serves site/ here until the owners choose a domain; when it
    # changes, this default, the canonical link, the sharing tags and the paths of the 404 page change together.
    [string]$Address = 'https://showtrace.github.io/showtrace/'
)
$root = Split-Path $PSScriptRoot -Parent
$problems = New-Object System.Collections.Generic.List[string]
$basePath = ([uri]$Address).AbsolutePath

# 1. Files.
$required = @('site/index.html', 'site/404.html', 'site/styles.css', 'site/demonstrations.js', 'site/logo.svg', 'site/favicon.svg',
    'site/fonts/AtkinsonHyperlegibleNext-wght.woff2', 'site/fonts/AtkinsonHyperlegibleNext-Italic-wght.woff2', 'site/fonts/OFL.txt')
foreach ($item in $required) {
    if (-not (Test-Path (Join-Path $root $item))) { $problems.Add("$item is missing") }
}
"Files: $($required.Count) required paths looked for."

# Every file of the site, tracked and untracked, without the ignored ones: the names local references resolve to,
# compared with their case. The files to read leave out pictures and fonts.
$listed = @(& git -C $root -c core.quotepath=off ls-files --cached --others --exclude-standard)
if ($listed.Count -eq 0) { Write-Error "No files found in $root."; exit 2 }
$known = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
foreach ($item in $listed) { [void]$known.Add($item) }
$files = @($listed | Where-Object { $_ -notmatch '\.(png|jpg|jpeg|gif|ico|webp|woff2?|pdf)$' })
$pages = @($files | Where-Object { $_ -match '\.html$' })
$sheets = @($files | Where-Object { $_ -match '\.css$' })
$scripts = @($files | Where-Object { $_ -match '\.js$' })
$drawings = @($files | Where-Object { $_ -match '\.svg$' })

# 2. Typography. The characters are built from their code points, so that this file stays plain ASCII.
$typography = '[' + (-join ((0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2190, 0x2192, 0x21D2, 0x2026) | ForEach-Object { [char]$_ })) + ']'
$names = @{ 0x2013 = 'en dash'; 0x2014 = 'em dash'; 0x2018 = 'curly quote'; 0x2019 = 'curly quote'; 0x201C = 'curly quote'; 0x201D = 'curly quote'; 0x2190 = 'arrow'; 0x2192 = 'arrow'; 0x21D2 = 'arrow'; 0x2026 = 'ellipsis' }
$entities = '&(mdash|ndash|hellip|lsquo|rsquo|ldquo|rdquo|larr|rarr|rArr);|&#(8211|8212|8216|8217|8220|8221|8230|8592|8594|8658);|&#x(201[34]|201[89]|201[CDcd]|2026|2190|2192|21[Dd]2);'
foreach ($file in $files) {
    if ($file -eq 'site/fonts/OFL.txt') { continue }   # the licence text is the font's own and is not edited
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

# 3. Words. Whole words, without regard to case, in the pages and the script (its texts reach the visitor too).
# The list is brand.md, section 5, "Words we avoid", plus the old prototype name and the word the brand does not use
# for marks.
$avoid = @('AI-powered', 'intelligent', 'smart', 'seamless', 'effortless', 'powerful', 'revolutionary', 'unlock', 'empower', 'boost', 'leverage', 'next-generation', 'cutting-edge', 'unique', 'the first', 'monitoring', 'tracking', 'surveillance', 'annotation', 'annotations', 'annotate', 'Marker')
foreach ($file in ($pages + $scripts)) {
    $number = 0
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $root $file))) {
        $number++
        foreach ($word in $avoid) {
            if ($line -match ('\b' + [regex]::Escape($word) + '\b')) { $problems.Add("${file}:${number}: '$word' is a word the brand guide avoids (brand.md, section 5)") }
        }
        if ($line -match 'for Windows' -and $line -notmatch 'class="[^"]*\bdownload-button\b') { $problems.Add("${file}:${number}: 'for Windows' stands outside a download button (brand.md, section 2)") }
    }
}
"Words: $($pages.Count) pages and $($scripts.Count) scripts read for the $($avoid.Count) words the brand guide avoids and for 'for Windows'."

# The start tags of an HTML page or an SVG file, with their attributes (names in lower case) and the line each
# starts on. Tags are read from the whole text, so that a tag written over several lines is read whole.
function Get-Tags([string]$text) {
    $tags = New-Object System.Collections.Generic.List[object]
    $tagPattern = '<([A-Za-z][A-Za-z0-9:-]*)((?:\s+[^\s"''<>/=]+(?:\s*=\s*(?:"[^"]*"|''[^'']*''|[^\s"''=<>`]+))?)*)\s*/?>'
    $attributePattern = '([^\s"''<>/=]+)(?:\s*=\s*(?:"([^"]*)"|''([^'']*)''|([^\s"''=<>`]+)))?'
    foreach ($m in [regex]::Matches($text, $tagPattern)) {
        $attributes = @{}
        foreach ($a in [regex]::Matches($m.Groups[2].Value, $attributePattern)) {
            $attributes[$a.Groups[1].Value.ToLowerInvariant()] = $a.Groups[2].Value + $a.Groups[3].Value + $a.Groups[4].Value
        }
        $line = 1 + [regex]::Matches($text.Substring(0, $m.Index), "`n").Count
        $tags.Add([pscustomobject]@{ Name = $m.Groups[1].Value.ToLowerInvariant(); Attributes = $attributes; Line = $line })
    }
    return , $tags
}

# An address with a scheme (https:, data:, mailto:) or a network path (//host): something outside the site.
function Test-Outside([string]$value) { return ($value.Trim() -match '^([A-Za-z][A-Za-z0-9+.-]*:|//)') }

# The content of a meta tag is text, unless it is a web address (scheme:// or //host): "Showtrace: mark any screen"
# is a title, not an address.
function Test-WebAddress([string]$value) { return ($value.Trim() -match '^([A-Za-z][A-Za-z0-9+.-]*:)?//') }

# The repository path a local reference names, from the folder of the file that names it, or '' when the path from
# the root does not start with the path of the public address or the reference climbs out of the site.
function Resolve-Local([string]$folder, [string]$reference) {
    $path = [uri]::UnescapeDataString(($reference.Trim() -split '[?#]', 2)[0])
    if ($path.StartsWith('/')) {
        if (-not $path.StartsWith($basePath)) { return '' }
        $segments = @('site') + @($path.Substring($basePath.Length) -split '/')
    }
    else { $segments = @($folder -split '/') + @($path -split '/') }
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($segment in $segments) {
        if ($segment -eq '' -or $segment -eq '.') { continue }
        if ($segment -eq '..') { if ($parts.Count -gt 0) { $parts.RemoveAt($parts.Count - 1) }; continue }
        $parts.Add($segment)
    }
    $resolved = $parts -join '/'
    if ($path -eq '' -or $path.EndsWith('/')) { $resolved = "$resolved/index.html" }
    if (-not $resolved.StartsWith('site/')) { return '' }
    return $resolved
}

# Adds a problem when a local reference does not name a file of the site, in its case.
function Test-Reference([string]$file, [int]$number, [string]$reference) {
    $folder = Split-Path $file -Parent
    $target = Resolve-Local ($folder -replace '\\', '/') $reference
    if ($target -eq '') { $problems.Add("${file}:${number}: '$reference' is outside the site; a path from the root starts with $basePath, the path of the public address") }
    elseif (-not $known.Contains($target)) { $problems.Add("${file}:${number}: '$reference' names $target, which is not a file of the site (the case counts)") }
}

# The attributes that load what they name, and the elements that embed a document or send.
$loading = @('src', 'srcset', 'poster', 'data', 'action', 'formaction', 'background', 'manifest', 'href', 'xlink:href')
$embedding = @('iframe', 'frame', 'frameset', 'object', 'embed', 'portal', 'applet')
$idLists = @('aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-details', 'aria-flowto', 'aria-owns', 'for', 'headers', 'list')

# 4. Scripts and the policy; 6. addresses and resources; 7. local references. Pages and SVG files, tag by tag.
$allowedScript = '^\s*<script src="demonstrations\.js" defer></script>\s*$'
foreach ($file in ($pages + $drawings)) {
    $text = [IO.File]::ReadAllText((Join-Path $root $file))
    $isPage = $file -match '\.html$'
    $tags = Get-Tags $text

    if ($isPage) {
        # The one script, by its exact line.
        $number = 0
        foreach ($line in ($text -split "`n")) {
            $number++
            if ($line -match '<script' -and $line -notmatch $allowedScript) { $problems.Add("${file}:${number}: a script other than the site's own demonstrations.js; no inline script, no script from another domain") }
        }
    }

    $ids = @{}
    foreach ($tag in $tags) {
        if ($tag.Attributes.ContainsKey('id')) {
            $id = $tag.Attributes['id']
            if ($ids.ContainsKey($id)) { $problems.Add("${file}:$($tag.Line): the id '$id' is used twice; a link or a label to it is ambiguous") }
            else { $ids[$id] = $tag.Line }
        }
    }

    $policy = $null
    $policyAt = -1
    $firstLoadAt = -1
    $hasScript = $false
    $hasSheet = $false
    for ($i = 0; $i -lt $tags.Count; $i++) {
        $tag = $tags[$i]
        $name = $tag.Name
        $at = "${file}:$($tag.Line)"
        $a = $tag.Attributes
        if ($name -eq 'script') { $hasScript = $true }
        if ($name -eq 'link' -and $a.ContainsKey('rel') -and (' ' + $a['rel'].ToLowerInvariant() + ' ') -match ' stylesheet ') { $hasSheet = $true }
        if ($firstLoadAt -lt 0 -and ($name -in @('link', 'script', 'style', 'img', 'source', 'video', 'audio', 'image') -or $name -in $embedding)) { $firstLoadAt = $i }

        # 4. Inline code and inline styles.
        if ($isPage -and $name -eq 'style') { $problems.Add("${at}: a style element; the content security policy allows the stylesheet only") }
        if ($name -eq 'script' -and -not $isPage) { $problems.Add("${at}: a script in an SVG file; a drawing of the site runs nothing") }
        foreach ($key in @($a.Keys)) {
            if ($key -match '^on[a-z]+$') { $problems.Add("${at}: the event handler attribute '$key'; the page has no inline JavaScript") }
            if ($isPage -and $key -eq 'style') { $problems.Add("${at}: an inline style attribute; the content security policy allows the stylesheet only") }
            if ($a[$key].Trim() -match '^javascript:') { $problems.Add("${at}: a javascript: address; the page has no inline JavaScript") }
        }
        if ($name -eq 'meta' -and $a.ContainsKey('http-equiv') -and $a['http-equiv'].ToLowerInvariant() -eq 'content-security-policy') {
            if ($policy -ne $null) { $problems.Add("${at}: a second content security policy; one policy says what the page allows") }
            else { $policy = $a['content']; $policyAt = $i }
        }

        # 6. Addresses and resources.
        if ($name -in $embedding) { $problems.Add("${at}: an embedded document ($name); the page carries no tracker and no other site") }
        if ($name -eq 'base') { $problems.Add("${at}: a base element; every address in the page is its own") }
        if ($name -eq 'form') { $problems.Add("${at}: a form; the page sends nothing") }
        if ($a.ContainsKey('ping')) { $problems.Add("${at}: a ping attribute; following a link sends nothing") }
        if ($name -eq 'meta' -and $a.ContainsKey('http-equiv') -and $a['http-equiv'].ToLowerInvariant() -eq 'refresh') { $problems.Add("${at}: a refresh; the page does not move the visitor on by itself") }
        if ($name -eq 'meta' -and $a.ContainsKey('content') -and (Test-WebAddress $a['content'])) {
            # An address in a sharing tag: the site's own public address, and a file there.
            $value = $a['content'].Trim()
            if (-not $value.StartsWith($Address)) { $problems.Add("${at}: the address '$value' is not the site's public address $Address") }
            else { Test-Reference $file $tag.Line ($basePath + $value.Substring($Address.Length)) }
        }
        foreach ($key in $loading) {
            if (-not $a.ContainsKey($key)) { continue }
            $value = $a[$key].Trim()
            $candidates = @($value)
            if ($key -eq 'srcset') { $candidates = @($value -split ',' | ForEach-Object { ($_.Trim() -split '\s+')[0] } | Where-Object { $_ }) }
            foreach ($candidate in $candidates) {
                if ($candidate.StartsWith('#')) {
                    # 7. A link or a use within the page names an id on it.
                    if (-not $ids.ContainsKey($candidate.Substring(1))) { $problems.Add("${at}: '$candidate' names no id in this file") }
                    continue
                }
                if ($key -eq 'href' -and $name -in @('a', 'area')) {
                    # A link loads nothing until it is followed; one to another site is fine.
                    if (-not (Test-Outside $candidate)) { Test-Reference $file $tag.Line $candidate }
                    continue
                }
                $rel = ''
                if ($a.ContainsKey('rel')) { $rel = ' ' + $a['rel'].ToLowerInvariant() + ' ' }
                if ($name -eq 'link' -and $key -eq 'href' -and $rel -match ' (canonical|alternate) ') {
                    # The canonical link names an address and loads nothing: the site's own public address.
                    if (-not $candidate.StartsWith($Address)) { $problems.Add("${at}: the address '$candidate' is not the site's public address $Address") }
                    else { Test-Reference $file $tag.Line ($basePath + $candidate.Substring($Address.Length)) }
                    continue
                }
                if ($candidate -match '^data:') { $problems.Add("${at}: a data: address; everything the page loads is a file of the site") }
                elseif (Test-Outside $candidate) { $problems.Add("${at}: '$candidate' is loaded from outside the site; everything is served from this site") }
                else { Test-Reference $file $tag.Line $candidate }
            }
        }

        # 7. Id references.
        foreach ($key in $idLists) {
            if (-not $a.ContainsKey($key)) { continue }
            foreach ($id in @($a[$key] -split '\s+' | Where-Object { $_ })) {
                if (-not $ids.ContainsKey($id)) { $problems.Add("${at}: $key names the id '$id', which is not on this page") }
            }
        }
    }

    if (-not $isPage) { continue }
    # 4. The policy: before anything the page loads, and as strict as the site's.
    if ($policy -eq $null) { $problems.Add("${file}: no content security policy meta tag"); continue }
    if ($firstLoadAt -ge 0 -and $firstLoadAt -lt $policyAt) { $problems.Add("${file}:$($tags[$policyAt].Line): the content security policy comes after something the page loads; it holds only for what follows it") }
    $directives = @{}
    foreach ($part in ($policy -split ';')) {
        $tokens = @($part.Trim() -split '\s+' | Where-Object { $_ })
        if ($tokens.Count -eq 0) { continue }
        $directives[$tokens[0].ToLowerInvariant()] = @($tokens | Select-Object -Skip 1)
    }
    foreach ($directive in @($directives.Keys)) {
        $sources = @($directives[$directive])
        foreach ($source in $sources) {
            if ($source -notin @("'self'", "'none'")) { $problems.Add("${file}: the content security policy allows $source in $directive; only 'self' or 'none'") }
        }
        if ($sources -contains "'none'" -and $sources.Count -gt 1) { $problems.Add("${file}: the content security policy combines 'none' with other sources in $directive") }
    }
    foreach ($directive in @('default-src', 'base-uri', 'form-action')) {
        if (-not $directives.ContainsKey($directive) -or ($directives[$directive] -join ' ') -ne "'none'") { $problems.Add("${file}: the content security policy needs $directive 'none'") }
    }
    $wanted = "'none'"
    if ($hasScript) { $wanted = "'self'" }
    if (-not $directives.ContainsKey('script-src') -or ($directives['script-src'] -join ' ') -ne $wanted) { $problems.Add("${file}: the content security policy needs script-src $wanted, because the page has $(if ($hasScript) { 'a script' } else { 'no script' })") }
    if ($hasSheet -and (-not $directives.ContainsKey('style-src') -or ($directives['style-src'] -join ' ') -ne "'self'")) { $problems.Add("${file}: the content security policy needs style-src 'self' for the stylesheet") }
}
"Scripts and the policy: $($pages.Count) pages read for scripts, handlers, inline styles, javascript: addresses and the content security policy."

# 5. Script content. The namespace of SVG is the one address the script may name.
$leaves = @('fetch\s*\(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'serviceWorker', 'localStorage', 'sessionStorage', 'indexedDB', 'document\.cookie', 'import\s*\(', 'importScripts', '\beval\s*\(', 'new\s+Function', 'https?://(?!www\.w3\.org/)')
foreach ($file in $scripts) {
    $number = 0
    foreach ($line in [IO.File]::ReadAllLines((Join-Path $root $file))) {
        $number++
        foreach ($pattern in $leaves) {
            if ($line -match $pattern) { $problems.Add("${file}:${number}: '$($Matches[0])': the script sends nothing, stores nothing, loads nothing and evaluates no code") }
        }
    }
}
"Script content: $($scripts.Count) scripts read for requests, storage, cookies, modules, eval and other domains."

# 6 and 7 for the stylesheets: nothing from another domain, and every file a url() names exists.
foreach ($file in $sheets) {
    $text = [IO.File]::ReadAllText((Join-Path $root $file))
    foreach ($m in [regex]::Matches($text, '@import|url\(\s*["'']?([^"''\)]*)["'']?\s*\)')) {
        $number = 1 + [regex]::Matches($text.Substring(0, $m.Index), "`n").Count
        if ($m.Value -eq '@import') { $problems.Add("${file}:${number}: an @import; the site has one stylesheet"); continue }
        $reference = $m.Groups[1].Value.Trim()
        if ($reference -eq '' -or $reference.StartsWith('#')) { continue }
        if ($reference -match '^data:') { $problems.Add("${file}:${number}: a data: address; everything the stylesheet loads is a file of the site") }
        elseif (Test-Outside $reference) { $problems.Add("${file}:${number}: '$reference' is loaded from outside the site; everything is served from this site") }
        else { Test-Reference $file $number $reference }
    }
}
"Addresses and references: $($pages.Count) pages, $($drawings.Count) SVG files and $($sheets.Count) stylesheets read for resources from outside the site, embedded documents, forms, pings and refreshes, for addresses other than $Address, and for references to files and ids that do not exist."

if ($problems.Count -gt 0) {
    ''
    $problems | ForEach-Object { "FAIL: $_" }
    "$($problems.Count) problem(s)"
    exit 1
}
'PASS: the site checks found nothing.'
exit 0
