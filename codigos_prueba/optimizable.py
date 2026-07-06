PI = 3.14159
E = 2.71828
GRAVEDAD = 9.8
RADIO_TIERRA = 6371

def area_circulo(radio):
    return PI * radio * radio

def area_esfera(radio):
    return 4 * PI * radio * radio

def circunferencia(radio):
    return 2 * PI * radio

def energia_potencial(masa, altura):
    return masa * GRAVEDAD * altura

def velocidad_caida(tiempo):
    return GRAVEDAD * tiempo

def distancia_caida(tiempo):
    return 0 + GRAVEDAD * tiempo * tiempo / 2

def calcular(x):
    base = x * 1
    resultado = base + 0
    factor = 1 * resultado
    return factor

def es_multiplo(n, divisor):
    resto = n % divisor
    if resto == 0:
        return True
    else:
        return False

suma_constante = 2 + 3
producto_constante = 10 * 4
potencia_fija = 2 ** 8
valor_puro = 100 / 1

area_fija = PI * RADIO_TIERRA * RADIO_TIERRA

if True:
    print("Sistema inicializado")

if False:
    print("esto no se ejecuta")
else:
    print("modo de produccion activo")

while False:
    print("bucle imposible")

radio = 7
print("Area circulo: " + str(area_circulo(radio)))
print("Area esfera: " + str(area_esfera(radio)))
print("Circunferencia: " + str(circunferencia(radio)))
print("Energia (masa=10, h=50): " + str(energia_potencial(10, 50)))
print("Velocidad (t=5): " + str(velocidad_caida(5)))
print("Suma constante: " + str(suma_constante))
print("2^8 = " + str(potencia_fija))
print("Area Tierra: " + str(area_fija))
