# Código con múltiples oportunidades de optimización

PI = 3.14159
RADIO = 5

# Plegado de constantes: 2 + 3 → 5, 10 * 2 → 20
suma = 2 + 3
doble = 10 * 2
potencia = 2 ** 8

# Simplificación algebraica: x * 1, x + 0, x ** 1
area = RADIO * 1
perimetro = 0 + RADIO
valor = potencia ** 1

# Propagación de constantes: PI y RADIO se sustituyen
circunferencia = 2 * PI
volumen = RADIO * RADIO * RADIO

# Eliminación de código muerto
def calcular(x):
    resultado = x * PI
    return resultado
    print("esto nunca se ejecuta")
    suma = x + 100

# Rama estática eliminada
if True:
    print("siempre se ejecuta")

if False:
    print("nunca se ejecuta")
else:
    print("esta si")

# Reducción de potencia: n ** 2 → n * n
def cuadrado(n):
    return n ** 2

# while False eliminado
while False:
    print("bucle imposible")

print("Fin del programa")
