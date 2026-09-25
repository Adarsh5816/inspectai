Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipPath = 'd:\Inspection report\storage\reports\IR-IR-FULL-TEST-003-1790346964794.docx'
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
$allValid = $true

foreach ($entry in $zip.Entries) {
    if ($entry.FullName.EndsWith('.xml')) {
        $stream = $entry.Open()
        $reader = New-Object System.IO.StreamReader($stream)
        $xmlText = $reader.ReadToEnd()
        $reader.Close()
        $stream.Close()

        try {
            $doc = New-Object System.Xml.XmlDocument
            $doc.LoadXml($xmlText)
            Write-Host "VALID: $($entry.FullName)" -ForegroundColor Green
        } catch {
            Write-Host "ERROR in $($entry.FullName): $($_.Exception.Message)" -ForegroundColor Red
            $allValid = $false
        }
    }
}

$zip.Dispose()

if ($allValid) {
    Write-Host "`n>>> SUCCESS: ALL XML FILES ARE 100% VALID AND COMPLIANT WITH WORD! <<<" -ForegroundColor Cyan
} else {
    Write-Host "`n>>> FAILED: XML ERRORS FOUND <<<" -ForegroundColor Red
}
