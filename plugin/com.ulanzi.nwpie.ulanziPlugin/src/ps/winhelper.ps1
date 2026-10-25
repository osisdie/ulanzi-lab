# Long-running Windows helper for ulanzi-lab: one JSON request per stdin line, one JSON reply per stdout line.
#   {"id":1,"cmd":"media"}  {"id":2,"cmd":"media.ctl","arg":"playpause"}  {"id":3,"cmd":"audio"}
#   {"id":4,"cmd":"audio.set","arg":{"what":"mute"}}  {"id":5,"cmd":"perf"}
#   {"id":6,"cmd":"clip.set","arg":"text"}  {"id":7,"cmd":"mic.default"}
# Media = Windows media session (SMTC: Spotify, browsers/YouTube Music, ...). Audio = Core Audio COM.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -AssemblyName System.Drawing
Add-Type -Language CSharp -ReferencedAssemblies System.Drawing @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace UL {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom {}
  [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")] class PolicyConfigCom {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int dataFlow, int stateMask, out IMMDeviceCollection devices);
    int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { int GetCount(out int count); int Item(int i, out IMMDevice device); }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IPropertyStore store);
    int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }
  [Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { int GetCount(out int c); int GetAt(int i, out PROPERTYKEY k); int GetValue(ref PROPERTYKEY k, out PROPVARIANT v); }
  [StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit)] struct PROPVARIANT { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; [FieldOffset(8)] public long pad; [FieldOffset(16)] public long pad2; }
  [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p); int GetChannelCount(out int c);
    int SetMasterVolumeLevel(float l, Guid g); int SetMasterVolumeLevelScalar(float l, Guid g);
    int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l);
    int SetChannelVolumeLevel(int c, float l, Guid g); int SetChannelVolumeLevelScalar(int c, float l, Guid g);
    int GetChannelVolumeLevel(int c, out float l); int GetChannelVolumeLevelScalar(int c, out float l);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
  }
  [Guid("f8679f50-850a-41cf-9c72-430f290290c8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPolicyConfig {
    int GetMixFormat(); int GetDeviceFormat(); int ResetDeviceFormat(); int SetDeviceFormat(); int GetProcessingPeriod();
    int SetProcessingPeriod(); int GetShareMode(); int SetShareMode(); int GetPropertyValue(); int SetPropertyValue();
    int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
    int SetEndpointVisibility();
  }

  public class Device { public string id; public string name; public bool isDefault; }

  public static class Audio {
    static IMMDeviceEnumerator En() { return (IMMDeviceEnumerator)new MMDeviceEnumeratorCom(); }
    static IAudioEndpointVolume Vol(int flow) {
      IMMDevice d; En().GetDefaultAudioEndpoint(flow, 1, out d);
      Guid iid = typeof(IAudioEndpointVolume).GUID; object o; d.Activate(ref iid, 23, IntPtr.Zero, out o);
      return (IAudioEndpointVolume)o;
    }
    public static float GetVolume() { float v; Vol(0).GetMasterVolumeLevelScalar(out v); return v; }
    public static void SetVolume(float v) { Vol(0).SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), Guid.Empty); }
    public static bool GetMute(int flow) { bool m; Vol(flow).GetMute(out m); return m; }
    public static void SetMute(int flow, bool m) { Vol(flow).SetMute(m, Guid.Empty); }
    public static bool HasCapture() { try { IMMDevice d; return En().GetDefaultAudioEndpoint(1, 1, out d) == 0 && d != null; } catch { return false; } }
    public static string CaptureName() { try { IMMDevice d; return En().GetDefaultAudioEndpoint(1, 1, out d) == 0 && d != null ? Name(d) : null; } catch { return null; } }
    static string Name(IMMDevice d) {
      IPropertyStore s; d.OpenPropertyStore(0, out s);
      PROPERTYKEY k = new PROPERTYKEY { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
      PROPVARIANT v; s.GetValue(ref k, out v);
      return v.vt == 31 ? Marshal.PtrToStringUni(v.p) : "?";
    }
    public static List<Device> Outputs() {
      var list = new List<Device>();
      IMMDevice def; En().GetDefaultAudioEndpoint(0, 1, out def); string defId; def.GetId(out defId);
      IMMDeviceCollection c; En().EnumAudioEndpoints(0, 1, out c); int n; c.GetCount(out n);
      for (int i = 0; i < n; i++) { IMMDevice d; c.Item(i, out d); string id; d.GetId(out id); list.Add(new Device { id = id, name = Name(d), isDefault = id == defId }); }
      return list;
    }
    public static void SetDefault(string id) {
      var pc = (IPolicyConfig)new PolicyConfigCom();
      for (int role = 0; role < 3; role++) pc.SetDefaultEndpoint(id, role);
    }
  }

  public static class Img {
    // Average colour of an image (album-art accent), as #rrggbb, skipping near-black/near-white pixels.
    public static string Accent(byte[] bytes) {
      using (var ms = new System.IO.MemoryStream(bytes)) using (var bmp = new System.Drawing.Bitmap(ms)) {
        long r = 0, g = 0, b = 0, n = 0; int step = Math.Max(1, bmp.Width / 24);
        for (int y = 0; y < bmp.Height; y += step) for (int x = 0; x < bmp.Width; x += step) {
          var c = bmp.GetPixel(x, y); int mx = Math.Max(c.R, Math.Max(c.G, c.B)), mn = Math.Min(c.R, Math.Min(c.G, c.B));
          if (mx < 40 || mn > 220 || mx - mn < 25) continue; r += c.R; g += c.G; b += c.B; n++;
        }
        if (n == 0) return "#8b949e";
        return string.Format("#{0:x2}{1:x2}{2:x2}", r / n, g / n, b / n);
      }
    }
  }
}
"@

# ---- WinRT async helper -------------------------------------------------------------------
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(4000) | Out-Null; $task.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgr = $null
function Manager { if (-not $script:mgr) { $script:mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]) }; $script:mgr }

$lastArtKey = ''; $lastArt = $null; $lastAccent = $null
function Media([bool]$withArt) {
  $s = (Manager).GetCurrentSession()
  if (-not $s) { return @{ active = $false } }
  $p = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $info = $s.GetPlaybackInfo(); $tl = $s.GetTimelineProperties()
  $key = "$($s.SourceAppUserModelId)|$($p.Title)|$($p.Artist)"
  if ($withArt -and $key -ne $script:lastArtKey -and $p.Thumbnail) {
    $script:lastArtKey = $key; $script:lastArt = $null; $script:lastAccent = $null
    try {
      $stream = Await ($p.Thumbnail.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
      $size = [uint32]$stream.Size
      $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
      $null = Await ($reader.LoadAsync($size)) ([uint32])
      $bytes = New-Object byte[] $size; $reader.ReadBytes($bytes)
      $script:lastArt = "data:$($stream.ContentType);base64," + [Convert]::ToBase64String($bytes)
      $script:lastAccent = [UL.Img]::Accent($bytes)
    } catch { }
  }
  @{
    active = $true; app = $s.SourceAppUserModelId; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle
    status = "$($info.PlaybackStatus)"; position = $tl.Position.TotalSeconds; duration = $tl.EndTime.TotalSeconds
    updatedAt = $tl.LastUpdatedTime.ToUnixTimeMilliseconds(); artKey = $key; art = $(if ($withArt) { $script:lastArt } else { $null }); accent = $script:lastAccent
  }
}

function MediaCtl([string]$what) {
  $s = (Manager).GetCurrentSession(); if (-not $s) { return @{ ok = $false } }
  $op = switch ($what) { 'playpause' { $s.TryTogglePlayPauseAsync() } 'next' { $s.TrySkipNextAsync() } 'prev' { $s.TrySkipPreviousAsync() } default { $null } }
  if (-not $op) { return @{ ok = $false } }
  @{ ok = [bool](Await $op ([bool])) }
}

function AudioState {
  $outs = [UL.Audio]::Outputs()
  @{
    volume = [math]::Round([UL.Audio]::GetVolume() * 100); muted = [UL.Audio]::GetMute(0)
    micMuted = $(if ([UL.Audio]::HasCapture()) { [UL.Audio]::GetMute(1) } else { $null })
    outputs = @($outs | ForEach-Object { @{ id = $_.id; name = $_.name; isDefault = $_.isDefault } })
  }
}

function AudioSet($a) {
  switch ($a.what) {
    'mute' { [UL.Audio]::SetMute(0, -not [UL.Audio]::GetMute(0)) }
    'mic' { if ([UL.Audio]::HasCapture()) { [UL.Audio]::SetMute(1, -not [UL.Audio]::GetMute(1)) } }
    'volume' { [UL.Audio]::SetVolume([float]([UL.Audio]::GetVolume() + [double]$a.delta / 100)) }
    'output' {
      $outs = @([UL.Audio]::Outputs()); if ($outs.Count -lt 2) { break }
      $i = 0; for ($k = 0; $k -lt $outs.Count; $k++) { if ($outs[$k].isDefault) { $i = $k } }
      [UL.Audio]::SetDefault($outs[($i + 1) % $outs.Count].id)
    }
  }
  AudioState
}

# ---- performance counters (created once) ---------------------------------------------------
$pc = @{}
function Counter($cat, $name, $inst) { $c = New-Object System.Diagnostics.PerformanceCounter($cat, $name, $inst, $true); [void]$c.NextValue(); $c }
$gpuAt = [datetime]::MinValue; $gpuCounters = @(); $vramCounters = @()
function Perf {
  if (-not $pc.netIn) {
    $pc.netIn = @((New-Object System.Diagnostics.PerformanceCounterCategory('Network Interface')).GetInstanceNames() | ForEach-Object { Counter 'Network Interface' 'Bytes Received/sec' $_ })
    $pc.netOut = @((New-Object System.Diagnostics.PerformanceCounterCategory('Network Interface')).GetInstanceNames() | ForEach-Object { Counter 'Network Interface' 'Bytes Sent/sec' $_ })
    $pc.diskR = Counter 'PhysicalDisk' 'Disk Read Bytes/sec' '_Total'
    $pc.diskW = Counter 'PhysicalDisk' 'Disk Write Bytes/sec' '_Total'
    $pc.diskBusy = Counter 'PhysicalDisk' '% Idle Time' '_Total'
  }
  # GPU engine instances come and go with processes; refresh the set every 15 s.
  if (([datetime]::Now - $script:gpuAt).TotalSeconds -gt 15) {
    $script:gpuAt = [datetime]::Now
    try {
      $script:gpuCounters = @((New-Object System.Diagnostics.PerformanceCounterCategory('GPU Engine')).GetInstanceNames() | Where-Object { $_ -like '*engtype_3D*' } | ForEach-Object { Counter 'GPU Engine' 'Utilization Percentage' $_ })
      $script:vramCounters = @((New-Object System.Diagnostics.PerformanceCounterCategory('GPU Adapter Memory')).GetInstanceNames() | ForEach-Object { Counter 'GPU Adapter Memory' 'Dedicated Usage' $_ })
    } catch { $script:gpuCounters = @(); $script:vramCounters = @() }
  }
  $sum = { param($cs) $t = 0.0; foreach ($c in $cs) { try { $t += $c.NextValue() } catch { } }; $t }
  @{
    netIn = & $sum $pc.netIn; netOut = & $sum $pc.netOut
    diskRead = $pc.diskR.NextValue(); diskWrite = $pc.diskW.NextValue(); diskBusy = [math]::Max(0, 100 - $pc.diskBusy.NextValue())
    gpu = [math]::Min(100, (& $sum $script:gpuCounters)); vram = & $sum $script:vramCounters
  }
}

# ---- loop --------------------------------------------------------------------------------------
[Console]::Out.WriteLine((@{ id = 0; ready = $true } | ConvertTo-Json -Compress))
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  if (-not $line.Trim()) { continue }
  $req = $null
  try {
    $req = $line | ConvertFrom-Json
    $res = switch ($req.cmd) {
      'media' { Media ([bool]$req.arg) }
      'media.ctl' { MediaCtl $req.arg }
      'audio' { AudioState }
      'audio.set' { AudioSet $req.arg }
      'perf' { Perf }
      'clip.set' { Set-Clipboard -Value ([string]$req.arg); @{ ok = $true } }
      'mic.default' { @{ name = [UL.Audio]::CaptureName() } }
      default { @{ error = "unknown cmd $($req.cmd)" } }
    }
    $out = @{ id = $req.id; ok = $true; data = $res }
  } catch {
    $out = @{ id = $(if ($req) { $req.id } else { -1 }); ok = $false; error = "$($_.Exception.Message)" }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 5))
}
