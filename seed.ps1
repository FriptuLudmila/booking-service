param(
  [string]$BaseUrl = "http://localhost:3001"
)

$ErrorActionPreference = 'Stop'

function Iso([datetime]$dt) { $dt.ToString('o') }

function New-Booking {
  param([string]$userId,[string]$room,[string]$start,[string]$end)
  $body = @{ userId=$userId; room=$room; startTime=$start; endTime=$end } | ConvertTo-Json -Compress
  try {
    $r = Invoke-RestMethod -Method POST -Uri "$BaseUrl/bookings" -ContentType 'application/json' -Body $body
    Write-Host ("+ created {0} [{1}] {2} -> {3}" -f $r.bookingId,$r.room,$r.startTime,$r.endTime)
    return $r
  } catch {
    $code = $null; try { $code = $_.Exception.Response.StatusCode.value__ } catch {}
    $msg = $_.ErrorDetails.Message; if (-not $msg) { $msg = $_.Exception.Message }
    Write-Host ("! create failed ({0}): {1}" -f $code,$msg) -ForegroundColor Yellow
    return $null
  }
}

Write-Host ("Target: {0}" -f $BaseUrl) -ForegroundColor Cyan

# 1) Delete ALL current bookings
try {
  $all = Invoke-RestMethod "$BaseUrl/bookings"
  if ($all -and $all.Count -gt 0) {
    Write-Host ("Deleting {0} existing bookings..." -f $all.Count) -ForegroundColor Magenta
    foreach ($b in $all) {
      try {
        Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/bookings/$($b.bookingId)" | Out-Null
        Write-Host ("- deleted {0}" -f $b.bookingId)
      } catch {
        $code = $null; try { $code = $_.Exception.Response.StatusCode.value__ } catch {}
        Write-Host ("! delete failed {0} ({1})" -f $b.bookingId,$code) -ForegroundColor Yellow
      }
    }
  } else {
    Write-Host "No existing bookings to delete."
  }
} catch {
  Write-Host ("! failed to list bookings: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
}

# 2) Seed ONLY 'main' and 'kitchen', non-overlapping per room
$now = Get-Date

# main
$main1S = Iso($now.AddMinutes(5));   $main1E = Iso($now.AddMinutes(65))
$main2S = Iso($now.AddMinutes(70));  $main2E = Iso($now.AddMinutes(130))

# kitchen
$kit1S  = Iso($now.AddMinutes(10));  $kit1E  = Iso($now.AddMinutes(50))
$kit2S  = Iso($now.AddMinutes(55));  $kit2E  = Iso($now.AddMinutes(95))

Write-Host "Creating bookings for rooms: main, kitchen..." -ForegroundColor Green
New-Booking 'u1' 'main'    $main1S $main1E | Out-Null
New-Booking 'u2' 'main'    $main2S $main2E | Out-Null
New-Booking 'u3' 'kitchen' $kit1S  $kit1E  | Out-Null
New-Booking 'u4' 'kitchen' $kit2S  $kit2E  | Out-Null

# 3) Summary
try {
  $after = Invoke-RestMethod "$BaseUrl/bookings"
  $countsByRoom = @{}
  foreach ($b in $after) {
    if (-not $countsByRoom.ContainsKey($b.room)) { $countsByRoom[$b.room] = 0 }
    $countsByRoom[$b.room]++
  }
  Write-Host "Done. Current counts:" -ForegroundColor Cyan
  $countsByRoom.GetEnumerator() | ForEach-Object { Write-Host ("  {0}: {1}" -f $_.Key,$_.Value) }
} catch {
  Write-Host "Done (could not fetch summary)." -ForegroundColor Cyan
}
