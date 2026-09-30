import 'dart:io';
import 'package:record/record.dart';
import 'package:audioplayers/audioplayers.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class AudioService extends StateNotifier<AudioState> {
  final AudioRecorder _recorder = AudioRecorder();
  final AudioPlayer _player = AudioPlayer();
  String? _currentRecordingPath;
  String? _currentPlaybackPath;

  AudioService() : super(const AudioState.idle());

  Future<bool> requestPermissions() async {
    final status = await Permission.microphone.request();
    return status == PermissionStatus.granted;
  }

  Future<void> startRecording() async {
    try {
      final hasPermission = await requestPermissions();
      if (!hasPermission) {
        state = const AudioState.error('Microphone permission denied');
        return;
      }

      if (await _recorder.hasPermission()) {
        final directory = await getApplicationDocumentsDirectory();
        _currentRecordingPath = '${directory.path}/recording_${DateTime.now().millisecondsSinceEpoch}.wav';
        
        await _recorder.start(
          const RecordConfig(
            sampleRate: 16000,
            numChannels: 1,
            bitRate: 256000,
          ),
          path: _currentRecordingPath!,
        );
        
        state = const AudioState.recording();
      }
    } catch (e) {
      state = AudioState.error('Recording error: $e');
    }
  }

  Future<String?> stopRecording() async {
    try {
      final path = await _recorder.stop();
      _currentRecordingPath = path;
      state = const AudioState.idle();
      return path;
    } catch (e) {
      state = AudioState.error('Stop recording error: $e');
      return null;
    }
  }

  Future<void> playAudio(String path) async {
    try {
      _currentPlaybackPath = path;
      await _player.play(DeviceFileSource(path));
      state = AudioState.playing(path);
      
      _player.onPlayerComplete.listen((_) {
        state = const AudioState.idle();
      });
    } catch (e) {
      state = AudioState.error('Playback error: $e');
    }
  }

  Future<void> stopPlayback() async {
    try {
      await _player.stop();
      state = const AudioState.idle();
    } catch (e) {
      state = AudioState.error('Stop playback error: $e');
    }
  }

  Future<void> pausePlayback() async {
    try {
      await _player.pause();
      state = const AudioState.paused(_currentPlaybackPath!);
    } catch (e) {
      state = AudioState.error('Pause error: $e');
    }
  }

  Future<void> resumePlayback() async {
    try {
      await _player.resume();
      state = AudioState.playing(_currentPlaybackPath!);
    } catch (e) {
      state = AudioState.error('Resume error: $e');
    }
  }

  Future<void> deleteRecording(String path) async {
    try {
      final file = File(path);
      if (await file.exists()) {
        await file.delete();
      }
    } catch (e) {
      state = AudioState.error('Delete error: $e');
    }
  }

  @override
  void dispose() {
    _recorder.dispose();
    _player.dispose();
    super.dispose();
  }
}

sealed class AudioState {
  const AudioState();
  
  const factory AudioState.idle() = AudioIdle;
  const factory AudioState.recording() = AudioRecording;
  const factory AudioState.playing(String path) = AudioPlaying;
  const factory AudioState.paused(String path) = AudioPaused;
  const factory AudioState.error(String message) = AudioError;
}

final audioServiceProvider = StateNotifierProvider<AudioService, AudioState>((ref) {
  return AudioService();
});
